import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, sql } from 'drizzle-orm';
import { generateUUID, generatePermissionPublicId } from '@/lib/crypto';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 声明式权限同步的单项数据结构
 */
interface IncomingPermission {
  code: string;
  name: string;
  type: 'MENU' | 'API' | 'DATA';
  resource?: string;
  action?: string;
  sort?: number;
  children?: IncomingPermission[];
}

/**
 * 将树状结构展平为扁平列表，计算 parentRelation 关系
 * 
 * @param tree 权限树
 * @param parentId 父级权限编码 (此处临时存为 code，后续在 DB ID 回填阶段映射为实际 UUID)
 * @returns 扁平化权限项列表
 */
function flattenPermissions(
  tree: IncomingPermission[],
  parentId: string | null = null
): Array<Omit<IncomingPermission, 'children'> & { parentId: string | null }> {
  let list: Array<Omit<IncomingPermission, 'children'> & { parentId: string | null }> = [];
  for (const node of tree) {
    list.push({
      code: node.code,
      name: node.name,
      type: node.type,
      resource: node.resource,
      action: node.action,
      sort: node.sort ?? 0,
      parentId,
    });
    if (node.children && node.children.length > 0) {
      list = list.concat(flattenPermissions(node.children, node.code));
    }
  }
  return list;
}

/**
 * 对 Client ID 计算 Hash Code，用于 PostgreSQL 会话级 Advisory Lock 的锁定 Key
 * 
 * @param str Client ID 字符串
 * @returns 锁定的 Hash 数值
 */
function getHashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * POST /api/permissions/register
 * 子系统声明式权限自动同步注册端点
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Basic Auth 鉴权头部提取与校验
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '缺少 Basic Auth 凭证' },
        { status: 401 }
      );
    }

    const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('utf-8');
    const [clientId, clientSecret] = credentials.split(':');

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '格式错误的 Basic Auth 凭证' },
        { status: 401 }
      );
    }

    // 2. 物理校验 Client ID 与 Client Secret 是否匹配
    const clientRecord = await db.select()
      .from(schema.clients)
      .where(eq(schema.clients.clientId, clientId))
      .limit(1);

    if (clientRecord.length === 0 || clientRecord[0].clientSecret !== clientSecret) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Client ID 或 Secret 错误，拒绝注册' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const incomingTree: IncomingPermission[] = body.permissions;

    if (!incomingTree || !Array.isArray(incomingTree)) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '权限数据格式错误，须为 permissions 数组' },
        { status: 400 }
      );
    }

    const flatIncoming = flattenPermissions(incomingTree);
    const incomingCodes = flatIncoming.map(p => p.code);

    // 防重校验：同一批次上报中不允许出现重复的 code 编码
    if (new Set(incomingCodes).size !== incomingCodes.length) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '上报的权限树中存在重复的 code' },
        { status: 400 }
      );
    }

    const lockKey = getHashCode(clientId);

    // 3. 开启 DB 事务，并实施 PG Advisory Lock
    const result = await db.transaction(async (tx) => {
      // 申请会话事务级 Advisory Lock（排他锁），会在事务 commit 或 rollback 后自动释放，规避死锁风险
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      // 查出 DB 中该 client 目前已有的所有权限记录
      const dbPermissions = await tx.select()
        .from(schema.permissions)
        .where(eq(schema.permissions.clientId, clientId));

      const dbMap = new Map(dbPermissions.map(p => [p.code, p]));
      const codeToIdMap = new Map<string, string>();
      
      // 初始化已存在的映射关系
      dbPermissions.forEach(p => {
        codeToIdMap.set(p.code, p.id);
      });

      const stats = { inserted: 0, updated: 0, deprecated: 0 };

      // A. 第一阶段：写入新增记录 & 更新已有记录的核心属性（排除 parentId，以防父节点尚未入库）
      const writePromises = flatIncoming.map(async (p) => {
        const existing = dbMap.get(p.code);
        if (!existing) {
          // 数据库中无记录，执行新增
          const id = generateUUID();
          const publicId = generatePermissionPublicId();
          codeToIdMap.set(p.code, id);

          await tx.insert(schema.permissions).values({
            id,
            publicId,
            name: p.name,
            code: p.code,
            type: p.type,
            resource: p.resource ?? null,
            action: p.action ?? null,
            clientId,
            parentId: null, // 第二阶段进行父级 ID 回填
            sort: p.sort,
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          stats.inserted++;
        } else {
          // 已有记录，检查属性是否变更
          codeToIdMap.set(p.code, existing.id);
          const needsUpdate =
            existing.name !== p.name ||
            existing.type !== p.type ||
            existing.resource !== (p.resource ?? null) ||
            existing.action !== (p.action ?? null) ||
            existing.sort !== p.sort ||
            existing.status !== 'ACTIVE';

          if (needsUpdate) {
            await tx.update(schema.permissions)
              .set({
                name: p.name,
                type: p.type,
                resource: p.resource ?? null,
                action: p.action ?? null,
                sort: p.sort,
                status: 'ACTIVE',
                updatedAt: new Date(),
              })
              .where(eq(schema.permissions.id, existing.id));
            stats.updated++;
          }
        }
      });

      await Promise.all(writePromises);

      // B. 安全红线：执行软删除下线逻辑
      const incomingCodesSet = new Set(incomingCodes);
      const deprecatePromises = dbPermissions
        .filter(p => !incomingCodesSet.has(p.code) && p.status === 'ACTIVE')
        .map(async (p) => {
          await tx.update(schema.permissions)
            .set({
              status: 'DISABLED',
              updatedAt: new Date(),
            })
            .where(eq(schema.permissions.id, p.id));
          stats.deprecated++;
        });

      await Promise.all(deprecatePromises);

      // C. 第二阶段：依据已填充完毕的 codeToIdMap 重新计算并回填真正的 parentId 物理关系
      const relationPromises = flatIncoming.map(async (p) => {
        const currentDbId = codeToIdMap.get(p.code);
        if (!currentDbId) return;

        let dbParentId: string | null = null;
        if (p.parentId) {
          dbParentId = codeToIdMap.get(p.parentId) ?? null;
        }

        const currentRecord = dbMap.get(p.code);
        if (!currentRecord || currentRecord.parentId !== dbParentId) {
          await tx.update(schema.permissions)
            .set({ parentId: dbParentId })
            .where(eq(schema.permissions.id, currentDbId));
        }
      });

      await Promise.all(relationPromises);

      return stats;
    });

    return NextResponse.json({ success: true, stats: result });
  } catch (error) {
    console.error('[Permissions Register POST] Failed to sync permissions:', error);
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '同步权限树失败' },
      { status: 500 }
    );
  }
}

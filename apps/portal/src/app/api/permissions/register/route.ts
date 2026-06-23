import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, sql, inArray, ne, isNull, or, and } from 'drizzle-orm';
import { generateUUID } from '@/lib/crypto';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { mapDomainError } from '@/domain/shared/error-mapping';


/**
 * 声明式权限同步的单项数据结构
 */
interface IncomingPermission {
  code: string;
  name: string;
  type: 'DIRECTORY' | 'PAGE' | 'API' | 'DATA';
  resource?: string;
  action?: string;
  /** PAGE/DIRECTORY 专属：前端路由路径 */
  path?: string;
  /** PAGE/DIRECTORY 专属：菜单图标 */
  icon?: string;
  /** PAGE/DIRECTORY 专属：菜单可见性 */
  visible?: boolean;
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
      path: node.path,
      icon: node.icon,
      visible: node.visible,
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

    // 全局 code 命名空间校验：permissions.code 为全局 UK（权限 code 是全局鉴权点，
    // 写入角色绑定 + JWT permissions claim + gateway 校验，必须全局唯一）。
    // 检测上报 code 是否与其他 client 或 Portal 内置权限（client_id IS NULL）重名，
    // 冲突时返回 409 + 前缀建议，避免落入事务内 unique violation 的 500。
    // 极小竞态窗口（检测后另一 client 注册同名）由 DB UK 兜底。
    if (incomingCodes.length > 0) {
      const rows = await db.select({ code: schema.permissions.code, clientId: schema.permissions.clientId })
        .from(schema.permissions)
        .where(and(
          inArray(schema.permissions.code, incomingCodes),
          or(ne(schema.permissions.clientId, clientId), isNull(schema.permissions.clientId)),
        ))
        .limit(1);
      // JS 层精确判定（DB where 已过滤；此处双重确认，兼容测试 mock 的全局返回）：
      // 仅当 code 实际在上报集合、且归属非本 client 时视为冲突
      const conflict = rows.find(r => incomingCodes.includes(r.code) && r.clientId !== clientId);
      if (conflict) {
        return NextResponse.json(
          {
            error: 'conflict',
            message: `权限 code「${conflict.code}」全局已被占用（其他 client 或 Portal 内置权限）。permissions.code 为全局唯一标识，建议使用「${clientId}:」前缀命名空间，如「${clientId}:${conflict.code}」。`,
          },
          { status: 409 }
        );
      }
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

      // 预分配新增权限的 UUID，构建完整的 code → DB id 映射
      // 这样 parentId 可以直接在写入时设置正确的值，无需第二阶段回填
      const codeToIdMap = new Map<string, string>();
      for (const p of dbPermissions) {
        codeToIdMap.set(p.code, p.id);
      }
      for (const p of flatIncoming) {
        if (!codeToIdMap.has(p.code)) {
          codeToIdMap.set(p.code, generateUUID());
        }
      }

      const stats = { inserted: 0, updated: 0, deprecated: 0 };

      // 单阶段写入：parentId 直接从 codeToIdMap 解析（预分配 ID + 已存在 ID 均已就位）
      const writePromises = flatIncoming.map(async (p) => {
        const dbParentId = p.parentId ? (codeToIdMap.get(p.parentId) ?? null) : null;
        const existing = dbMap.get(p.code);
        if (!existing) {
          const id = codeToIdMap.get(p.code)!;
          await tx.insert(schema.permissions).values({
            id,
            name: p.name,
            code: p.code,
            type: p.type,
            resource: p.resource ?? null,
            action: p.action ?? null,
            path: p.path ?? null,
            icon: p.icon ?? null,
            visible: p.visible ?? null,
            clientId,
            parentId: dbParentId,
            sort: p.sort,
            status: 'ACTIVE',
            createdAt: new Date(),
          });
          stats.inserted++;
        } else {
          // 检查属性或 parentId 是否变更
          const parentChanged = existing.parentId !== dbParentId;
          const propsChanged =
            existing.name !== p.name ||
            existing.type !== p.type ||
            existing.resource !== (p.resource ?? null) ||
            existing.action !== (p.action ?? null) ||
            existing.path !== (p.path ?? null) ||
            existing.icon !== (p.icon ?? null) ||
            existing.visible !== (p.visible ?? null) ||
            existing.sort !== p.sort ||
            existing.status !== 'ACTIVE';

          if (propsChanged || parentChanged) {
            await tx.update(schema.permissions)
              .set({
                name: p.name,
                type: p.type,
                resource: p.resource ?? null,
                action: p.action ?? null,
                path: p.path ?? null,
                icon: p.icon ?? null,
                visible: p.visible ?? null,
                sort: p.sort,
                status: 'ACTIVE',
                ...(parentChanged ? { parentId: dbParentId } : {}),
              })
              .where(eq(schema.permissions.id, existing.id));
            stats.updated++;
          }
        }
      });

      await Promise.all(writePromises);

      // 软删除下线：上报中不存在的权限标记为 DISABLED
      const incomingCodesSet = new Set(incomingCodes);
      const deprecatePromises = dbPermissions
        .filter(p => !incomingCodesSet.has(p.code) && p.status === 'ACTIVE')
        .map(async (p) => {
          await tx.update(schema.permissions)
            .set({ status: 'DISABLED' })
            .where(eq(schema.permissions.id, p.id));
          stats.deprecated++;
        });

      await Promise.all(deprecatePromises);

      return stats;
    });

    return NextResponse.json({ success: true, stats: result });
  } catch (error) {
    const mapped = mapDomainError(error);
    console.error('[Permissions Register POST] 同步权限树失败:', mapped.message, error instanceof Error ? error.stack : '');
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status },
    );
  }
}

/**
 * 权限同步领域函数（纯函数，零框架依赖）
 *
 * 提取自 permissions/register/route.ts 的编排逻辑，
 * 将树展平、Hash Code 计算、重复校验收敛为可测试的纯函数。
 *
 * @module domain/permission/permission-sync
 */

/** 声明式权限同步的单项数据结构 */
export interface IncomingPermission {
  code: string;
  name: string;
  type: 'DIRECTORY' | 'PAGE' | 'API';
  path?: string;
  icon?: string;
  visible?: boolean;
  sort?: number;
  children?: IncomingPermission[];
}

/** 扁平化后的权限项（含 parentId 关系） */
export interface FlatPermission {
  code: string;
  name: string;
  type: 'DIRECTORY' | 'PAGE' | 'API';
  path?: string;
  icon?: string;
  visible?: boolean;
  sort: number;
  parentId: string | null;
}

/**
 * 将树状结构展平为扁平列表，计算 parentRelation 关系
 *
 * @param tree     权限树
 * @param parentId 父级权限编码（递归时传递）
 * @returns 扁平化权限项列表
 */
export function flattenPermissions(
  tree: IncomingPermission[],
  parentId: string | null = null,
): FlatPermission[] {
  const list: FlatPermission[] = [];
  for (const node of tree) {
    list.push({
      code: node.code,
      name: node.name,
      type: node.type,
      path: node.path,
      icon: node.icon,
      visible: node.visible,
      sort: node.sort ?? 0,
      parentId,
    });
    if (node.children && node.children.length > 0) {
      list.push(...flattenPermissions(node.children, node.code));
    }
  }
  return list;
}

/**
 * 对字符串计算 Java 风格 Hash Code，用于 PostgreSQL 会话级 Advisory Lock
 *
 * @param str 输入字符串
 * @returns 非负整数 hash 值
 */
export function getHashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * 校验权限 code 列表中无重复
 *
 * @param codes 权限编码列表
 * @returns 重复的 code（如果有），否则 null
 */
export function findDuplicateCode(codes: string[]): string | null {
  const seen = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) return code;
    seen.add(code);
  }
  return null;
}

// ── 行整形与变更判定（#ADR-019 待修热点：register/route.ts 的复杂度 29 主要来自这里）──
//
// 抽出来的理由不是"数字好看"，而是：把这些 `??` 归一化与逐字段比较**集中一处**之后，
// 它们成为可直测的纯函数（此前只被"整条路由能跑"间接覆盖），而路由回到线性的编排。

/** 「是否变更」判定所依赖的已有行字段（结构化类型：领域层不依赖 Drizzle 的 schema） */
export interface ExistingPermissionRow {
  id: string;
  parentId: string | null;
  name: string;
  type: 'DIRECTORY' | 'PAGE' | 'API';
  path: string | null;
  icon: string | null;
  visible: boolean | null;
  sort: number;
  /** 与 DB 枚举同宽（写成 `string` 会让插入行不可赋值——tsc 会拦） */
  status: 'ACTIVE' | 'DISABLED';
}

/** 已有行与上报项**是否等价**（把所有"缺省即 null"的归一化收在这里） */
export function permissionRowChanged(
  existing: ExistingPermissionRow,
  incoming: FlatPermission,
  parentId: string | null,
): boolean {
  return (
    existing.parentId !== parentId
    || existing.name !== incoming.name
    || existing.type !== incoming.type
    || existing.path !== (incoming.path ?? null)
    || existing.icon !== (incoming.icon ?? null)
    || existing.visible !== (incoming.visible ?? null)
    || existing.sort !== incoming.sort
    || existing.status !== 'ACTIVE'
  );
}

/** 组装插入行（`code` 是插入的必填列，别漏——tsc 会在路由里当场拦下） */
export function toPermissionInsertRow(
  incoming: FlatPermission,
  ctx: { id: string; clientId: string; parentId: string | null; now: Date },
): ExistingPermissionRow & { code: string; clientId: string; createdAt: Date } {
  return {
    id: ctx.id,
    name: incoming.name,
    code: incoming.code,
    type: incoming.type,
    path: incoming.path ?? null,
    icon: incoming.icon ?? null,
    visible: incoming.visible ?? null,
    clientId: ctx.clientId,
    parentId: ctx.parentId,
    sort: incoming.sort,
    status: 'ACTIVE',
    createdAt: ctx.now,
  };
}

/** 更新行的形状：除 id 外都可写，但 `parentId` 是**可选的**（未变时不写） */
export type PermissionUpdateRow = Omit<ExistingPermissionRow, 'id' | 'parentId'> & {
  parentId?: string | null;
};

/**
 * 组装更新行：**parentId 仅在真的变了时才带**（未变时不写，避免无谓写与无谓的 WAL）。
 *
 * 注意写法：不是 `...(changed ? { parentId } : {})` —— 用显式赋值让"可选的 parentId"
 * 在类型上就是可选的（条件展开写成恒真/恒假都不会被编译器发现）。
 */
export function toPermissionUpdateRow(
  incoming: FlatPermission,
  ctx: { parentId: string | null; parentChanged: boolean },
): PermissionUpdateRow {
  const row: PermissionUpdateRow = {
    name: incoming.name,
    type: incoming.type,
    path: incoming.path ?? null,
    icon: incoming.icon ?? null,
    visible: incoming.visible ?? null,
    sort: incoming.sort,
    status: 'ACTIVE',
  };
  if (ctx.parentChanged) row.parentId = ctx.parentId;
  return row;
}

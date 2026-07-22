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

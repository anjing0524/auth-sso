/**
 * 泛型树构建工具 — 消除 buildMenuTree / buildDepartmentTree 重复
 *
 * 将扁平列表转换为树形结构（含递归 children 数组），支持可选按数字字段排序。
 * Menu 和 Department 的 buildXxxTree 均委托至此函数。
 *
 * @module domain/shared/tree-utils
 */

/** 递归树节点：T 被包裹为 children 自我引用类型 */
export type Tree<T> = T & { children: Tree<T>[] };

/**
 * 将扁平列表构建为树形结构（children 递归同类型）
 *
 * @param flatList  扁平数据列表
 * @param idKey     节点唯一标识的字段名
 * @param parentKey 父节点标识的字段名
 * @param sortKey   可选排序字段名（必须为数字类型），提供后树的每一层按此字段升序
 * @returns 根节点数组（含递归 children 嵌套）
 */
export function buildTree<
  T extends Record<string, any>,
>(
  flatList: T[],
  idKey: string & keyof T,
  parentKey: string & keyof T,
  sortKey?: string & keyof T,
): Tree<T>[] {
  const nodeMap = new Map<string, Tree<T>>();
  const roots: Tree<T>[] = [];

  // 第一遍：创建所有节点（含空 children）
  for (const item of flatList) {
    const node: Tree<T> = { ...item, children: [] };
    nodeMap.set(String(item[idKey]), node);
  }

  // 第二遍：分配父子关系
  for (const item of flatList) {
    const node = nodeMap.get(String(item[idKey]));
    if (!node) {
      // 理论上不应发生（第一遍已为所有 item 建立节点），防御性处理
      continue;
    }
    const parentId = item[parentKey] as string | null;
    if (parentId && nodeMap.has(parentId)) {
      const parentNode = nodeMap.get(parentId);
      if (!parentNode) {
        // 理论上不应发生，nodeMap.has() 已确认存在
        roots.push(node);
      } else {
        parentNode.children.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // 可选的按数字字段排序
  if (sortKey) {
    const sortRecursive = (nodes: Tree<T>[]): void => {
      nodes.sort((a, b) => Number(a[sortKey]) - Number(b[sortKey]));
      for (const n of nodes) {
        if (n.children.length > 0) sortRecursive(n.children);
      }
    };
    sortRecursive(roots);
  }

  return roots;
}

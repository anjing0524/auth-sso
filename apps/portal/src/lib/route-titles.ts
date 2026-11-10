/**
 * UX-07：面包屑末级与页面 H1 共用的路由标题单一真源。
 *
 * 走查发现新建用户 / 新建权限 / 审计详情 / 角色权限 4 处面包屑末级与页面 H1
 * 不同名，面包屑失去导航锚点意义。这里把末级标题收敛为常量，由面包屑构建函数
 * 与各页面 PageHeader / metadata 共同引用；一致性由
 * apps/portal/__tests__/components/breadcrumb-titles.test.ts 锁定。
 *
 * 例外（有意设计）：用户详情页 H1 显示实体姓名，面包屑保留页面类型名「用户详情」，
 * 因此不纳入同名约束——面包屑描述「在哪一类页面」，H1 描述「具体是哪个对象」。
 */
export const PAGE_TITLES = {
  NEW_USER: '新建用户',
  USER_DETAIL: '用户详情',
  ASSIGN_ROLE: '分配角色',
  NEW_CLIENT: '注册新应用',
  CLIENT_DETAIL: '应用详情',
  AUDIT_DETAIL: '审计日志详情',
  NEW_PERMISSION: '新建权限',
  EDIT_PERMISSION: '编辑权限',
  ROLE_PERMISSIONS: '配置功能权限',
} as const;

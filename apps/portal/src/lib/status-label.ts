/**
 * 状态文案与徽章色调的**唯一映射**。
 *
 * 背景：状态值在数据库/接口里是 `ACTIVE | DISABLED | LOCKED` 等枚举；
 * 此前各页面各自三元表达式渲染，出现「用户表格显示『正常』、角色/权限表格直接漏出 `ACTIVE`、
 * 应用表格显示 `ACTIVE/DISABLED`、个人中心显示 `Active`」四种写法。这里收敛为函数。
 */
type BadgeTone = 'success' | 'secondary' | 'destructive';

/** 账号状态（用户）：正常 / 已锁定 / 已禁用 */
export function accountStatus(status: string): { label: string; variant: BadgeTone } {
  switch (status) {
    case 'ACTIVE':
      return { label: '正常', variant: 'success' };
    case 'LOCKED':
      return { label: '已锁定', variant: 'destructive' };
    case 'DISABLED':
      return { label: '已禁用', variant: 'secondary' };
    default:
      return { label: status, variant: 'secondary' };
  }
}

/** 启用状态（角色 / 权限 / 应用）：已启用 / 已禁用 */
export function enableStatus(status: string): { label: string; variant: BadgeTone } {
  return status === 'ACTIVE'
    ? { label: '已启用', variant: 'success' }
    : { label: '已禁用', variant: 'secondary' };
}

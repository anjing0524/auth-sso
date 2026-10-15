/**
 * Dashboard 布局的展示映射（纯函数）
 *
 * ## 为什么单独成模块（#ADR-019 待修热点）
 *
 * `app/(dashboard)/layout.tsx` 的 `DashboardContent` 曾是 lint 复杂度告警点（16，阈值 15）。
 * 告警的来源不是"逻辑复杂"，而是**在 JSX 里就地做空值归一化**：五个 `user?.x ?? fallback`
 * 每个都是一次分支判定。把它们抽成一个纯映射后：
 *
 * - 组件回到"取身份 → 取数据 → 渲染"三步，读起来是线性的；
 * - 归一化规则**只有一处**（此前散在 JSX 的属性里），且可**直测**（空用户/有用户两种输入）。
 *
 * @module lib/dashboard-user
 */

/** DashboardLayout 需要的展示字段（与 `components/layout/DashboardLayout` 的 props 对齐） */
export interface DashboardUser {
  id: string;
  email: string | null;
  name: string;
  picture: string | null;
  emailVerified: boolean | null;
}

/** 映射输入：只依赖用到的字段（结构化类型，不绑定具体读口的返回类型） */
export interface DashboardUserSource {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean | null;
}

/**
 * 把用户读口的返回映射成展示字段；读不到时回落到身份里的 `fallbackId`。
 *
 * `name` 的兜底是 `'未知'`（界面必须始终有可显示的名字），其余字段兜 `null`。
 */
export function toDashboardUser(
  user: DashboardUserSource | null | undefined,
  fallbackId: string,
): DashboardUser {
  return {
    id: user?.id ?? fallbackId,
    email: user?.email ?? null,
    name: user?.name ?? '未知',
    picture: user?.avatarUrl ?? null,
    emailVerified: user?.emailVerified ?? null,
  };
}

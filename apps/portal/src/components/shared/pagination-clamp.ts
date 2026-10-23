/**
 * 页码跳转的纯函数钳制逻辑 — 客户端分页与服务端分页共用（U-G01）
 *
 * 背景：跳页输入曾依赖 `<input type="number" min max>` 的原生约束校验，越界输入
 * （0、999）会被浏览器**静默拦截**表单提交，用户点「跳转」没有任何反应。
 * 现在统一改为：去掉原生约束 → 提交时用本函数 clamp → 用可见 `aria-live` 提示说明结果。
 *
 * @module components/shared/pagination-clamp
 */

export interface JumpDecision {
  /** 最终要跳转到的页码（已钳制到 [1, totalPages]） */
  page: number;
  /** 需要展示给用户的提示；合法输入为 null（不打扰） */
  notice: string | null;
  /** 是否应执行跳转（空/非法输入时只提示、不跳转） */
  navigate: boolean;
}

/**
 * 计算跳页结果。
 *
 * @param raw 用户输入原值（字符串或数字）
 * @param totalPages 总页数（至少按 1 处理）
 */
export function clampJumpPage(raw: string | number | null | undefined, totalPages: number): JumpDecision {
  const pages = Math.max(1, Math.trunc(Number(totalPages)) || 1);
  const text = String(raw ?? '').trim();
  const parsed = Number.parseInt(text, 10);

  // 空输入 / 非数字：不跳转，只给出可执行提示
  if (!text || !Number.isFinite(parsed)) {
    return { page: 1, notice: `请输入 1–${pages} 之间的页码`, navigate: false };
  }

  const page = Math.min(Math.max(1, parsed), pages);
  // 越界：按既定设计仍跳转（clamp 到边界），但必须让用户知道实际落点
  if (page !== parsed) {
    return { page, notice: `页码超出范围（1–${pages}），已跳到第 ${page} 页`, navigate: true };
  }

  return { page, notice: null, navigate: true };
}

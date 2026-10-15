/**
 * `useFieldFailure` 直测：**有映射 ⇒ 就地；无映射 ⇒ toast**（且**不重复提示**）
 *
 * 这条判定此前在 create-user 路径上是内联的；抽成 hook 后四处表单共用同一实现，
 * 所以它值得被单独钉住——否则"映射存在但忘了渲染"这类错误没人会发现。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { USER_ERRORS, COMMON_ERRORS } from '@auth-sso/contracts';
import { useFieldFailure } from '@/hooks/use-field-failure';

// @allow-module-mock sonner full-replacement: 外部 UI 原语（toast 有 9 个签名各异的方法，类型化替身是与测试目的无关的类型工程），由组件测试整体替换
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('useFieldFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有字段映射的码：设置 fieldError，且**不**弹 toast', async () => {
    const { toast } = await import('sonner');
    const { result } = renderHook(() => useFieldFailure(['username', 'email']));

    act(() => {
      result.current.reportFailure({
        error: USER_ERRORS.USERNAME_ALREADY_EXISTS,
        message: '用户名已存在',
      });
    });

    expect(result.current.fieldError).toEqual({ field: 'username', message: '用户名已存在' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('先命中 email 字段；随后遇到无映射的码（403）⇒ 清掉 fieldError 并回落到 toast', async () => {
    const { toast } = await import('sonner');
    const { result } = renderHook(() => useFieldFailure(['username', 'email']));

    act(() => {
      result.current.reportFailure({ error: USER_ERRORS.EMAIL_ALREADY_EXISTS, message: '邮箱已存在' });
    });
    expect(result.current.fieldError?.field).toBe('email');

    act(() => {
      result.current.reportFailure({ error: COMMON_ERRORS.FORBIDDEN, message: '无权限' });
    });

    expect(result.current.fieldError).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('无权限');
  });

  it('映射存在但**本表单没有该字段** ⇒ 回落 toast（防静默失败）', async () => {
    const { toast } = await import('sonner');
    // 创建用户表单不采集 mobile ⇒ MOBILE_ALREADY_EXISTS 必须弹提示，而不是"无处显示"
    const { result } = renderHook(() => useFieldFailure(['username', 'email', 'password']));

    act(() => {
      result.current.reportFailure({ error: USER_ERRORS.MOBILE_ALREADY_EXISTS, message: '手机号已存在' });
    });

    expect(result.current.fieldError).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('手机号已存在');
  });

  it('clearFailure 清空（对话框重开时用）', () => {
    const { result } = renderHook(() => useFieldFailure(['password']));

    act(() => {
      result.current.reportFailure({ error: USER_ERRORS.PASSWORD_TOO_WEAK, message: '密码太弱' });
    });
    expect(result.current.fieldError).not.toBeNull();

    act(() => result.current.clearFailure());
    expect(result.current.fieldError).toBeNull();
  });
});

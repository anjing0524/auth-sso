/**
 * `useFieldFailure` 的直测（#92 的字段级失败处置）
 *
 * 此前只有"它被四处在用"的间接证据，**默认路径没有直测**。而默认路径（不传
 * `renderedFields`）恰恰是最容易出问题的地方：错误码有字段映射、但本表单**没有那个
 * 输入框**时，若照旧"就地显示"，就会出现**无处渲染、也不弹提示的静默失败**。
 *
 * 这里钉住三条：
 *   ① 默认（无渲染字段）：即使错误码**有**映射，也必须落回 toast，且 fieldError 为 null；
 *   ② 渲染了该字段：就地在字段上显示，且**不重复** toast；
 *   ③ message 为空时用兜底文案（代码评审曾查出 5 处因此丢文案）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { USER_ERRORS } from '@auth-sso/contracts';
import { useFieldFailure } from '@/hooks/use-field-failure';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

describe('useFieldFailure', () => {
  beforeEach(() => toastError.mockClear());

  it('默认（不传 renderedFields）：有字段映射也落回 toast，fieldError 保持 null（不静默吞错）', () => {
    const { result } = renderHook(() => useFieldFailure());

    act(() => result.current.reportFailure({ error: USER_ERRORS.EMAIL_ALREADY_EXISTS, message: '邮箱已存在' }));

    expect(result.current.fieldError, JSON.stringify(result.current.fieldError)).toBeNull();
    expect(toastError).toHaveBeenCalledWith('邮箱已存在');
  });

  it('渲染了该字段：就地显示且不重复 toast', () => {
    const { result } = renderHook(() => useFieldFailure(['email']));

    act(() => result.current.reportFailure({ error: USER_ERRORS.EMAIL_ALREADY_EXISTS, message: '邮箱已存在' }));

    expect(result.current.fieldError).toEqual({ field: 'email', message: '邮箱已存在' });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('无映射的错误码：落回 toast', () => {
    const { result } = renderHook(() => useFieldFailure(['email']));

    act(() => result.current.reportFailure({ error: 'SOME_UNMAPPED_CODE', message: '服务端拒绝' }));

    expect(result.current.fieldError).toBeNull();
    expect(toastError).toHaveBeenCalledWith('服务端拒绝');
  });

  it('message 为空时用兜底文案（默认 "操作失败"，可覆盖）', () => {
    const { result } = renderHook(() => useFieldFailure());

    act(() => result.current.reportFailure({ error: 'SOME_UNMAPPED_CODE', message: '' }));
    expect(toastError).toHaveBeenLastCalledWith('操作失败');

    act(() => result.current.reportFailure({ error: 'SOME_UNMAPPED_CODE', message: '' }, '更新失败'));
    expect(toastError).toHaveBeenLastCalledWith('更新失败');
  });

  it('clearFailure 清掉字段错误', () => {
    const { result } = renderHook(() => useFieldFailure(['email']));

    act(() => result.current.reportFailure({ error: USER_ERRORS.EMAIL_ALREADY_EXISTS, message: '邮箱已存在' }));
    expect(result.current.fieldError).not.toBeNull();

    act(() => result.current.clearFailure());
    expect(result.current.fieldError).toBeNull();
  });
});

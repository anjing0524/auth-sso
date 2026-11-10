/**
 * FormActionBar — 表单页统一底部操作条（UX-06）
 *
 * 行为契约：
 * - isDirty=true 时显示「有未保存的修改」状态徽标（role=status），否则不显示；
 * - hint 与按钮组都渲染在条内，按钮组靠右。
 *
 * @req UX-06
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormActionBar } from '@/components/shared/form-action-bar';

describe('FormActionBar', () => {
  it('isDirty 时显示未保存状态徽标，并渲染 hint 与按钮', () => {
    render(
      <FormActionBar isDirty hint={<span>提示文案</span>}>
        <button type="button">取消</button>
        <button type="submit">创建</button>
      </FormActionBar>,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('有未保存的修改');
    expect(screen.getByText('提示文案')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeInTheDocument();
  });

  it('非脏时不渲染状态徽标', () => {
    render(
      <FormActionBar>
        <button type="submit">保存</button>
      </FormActionBar>,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });
});

/**
 * TablePagination / 跳页组件测试（U-G01 回归）
 *
 * 背景（真实浏览器审计 U-G01）：跳页输入曾有 `min/max` 原生约束，输入越界页码
 * （如 999、0）后点击「跳转」被浏览器约束校验**静默拦截** —— 页面无任何反应。
 * 修复口径：去掉原生 min/max 拦截，改为 JS clamp + 可见 aria-live 提示。
 *
 * @req U-G01
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TablePagination } from '@/components/shared/table-pagination';

const clientBase = { page: 1, totalPages: 15, total: 211 };

describe('TablePagination 客户端模式（跳页）', () => {
  it('越界页码 999 提交后 clamp 到末页，并显示可见的 aria-live 提示', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<TablePagination {...clientBase} onPageChange={onPageChange} />);

    await user.type(screen.getByLabelText('跳至页码'), '999');
    await user.click(screen.getByRole('button', { name: '跳转' }));

    expect(onPageChange).toHaveBeenCalledWith(15);
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/超出范围|已跳到第 15 页/);
    expect(notice).toHaveAttribute('aria-live', 'polite');
  });

  it('空输入提交不跳页，并提示输入页码', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<TablePagination {...clientBase} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: '跳转' }));

    expect(onPageChange).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(/请输入/);
  });

  it('合法页码跳转且不显示提示', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<TablePagination {...clientBase} onPageChange={onPageChange} />);

    await user.type(screen.getByLabelText('跳至页码'), '7');
    await user.click(screen.getByRole('button', { name: '跳转' }));

    expect(onPageChange).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('跳页输入框不使用原生 min/max 约束（避免浏览器静默拦截提交）', () => {
    render(<TablePagination {...clientBase} onPageChange={vi.fn()} />);

    const input = screen.getByLabelText('跳至页码');
    expect(input).not.toHaveAttribute('min');
    expect(input).not.toHaveAttribute('max');
    expect(input.closest('form')).toHaveAttribute('novalidate');
  });

  it('页码按钮具备 focus-visible 设计系统焦点样式', () => {
    render(<TablePagination {...clientBase} onPageChange={vi.fn()} />);

    const pageTwo = screen.getByRole('button', { name: '第 2 页' });
    expect(pageTwo.className).toContain('focus-visible:outline-2');
    expect(pageTwo.className).toContain('focus-visible:outline-ring');
  });
});

describe('TablePagination 服务端模式（GET form 跳页）', () => {
  const serverBase = {
    page: 1,
    totalPages: 85,
    total: 1272,
    jumpAction: '/audit-logs',
    jumpParams: { tab: 'login' },
  };

  it('越界页码提交后 clamp 到末页并导航（保留其它查询参数）', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<TablePagination {...serverBase} navigate={navigate} />);

    const input = screen.getByLabelText('跳至页码');
    expect(input).not.toHaveAttribute('max');
    expect(input.closest('form')).toHaveAttribute('novalidate');

    await user.clear(input);
    await user.type(input, '999');
    await user.click(screen.getByRole('button', { name: '跳转' }));

    expect(navigate).toHaveBeenCalledWith('/audit-logs?tab=login&page=85');
    expect(await screen.findByRole('status')).toHaveTextContent(/超出范围|已跳到第 85 页/);
  });

  it('合法页码跳转且不显示提示', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<TablePagination {...serverBase} navigate={navigate} />);

    const input = screen.getByLabelText('跳至页码');
    await user.clear(input);
    await user.type(input, '42');
    await user.click(screen.getByRole('button', { name: '跳转' }));

    expect(navigate).toHaveBeenCalledWith('/audit-logs?tab=login&page=42');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

/**
 * 2026-10-23 UI 重做：只有一页时不再摆齐全套翻页控件（用户反馈"2 条记录 6 个按钮"）。
 * 合集仍是分页条的一部分，因此总数文案必须保留，翻页/跳页入口必须消失。
 */
describe('TablePagination 单页收敛', () => {
  it('totalPages<=1 时只显示总数，不渲染任何翻页/跳页控件', () => {
    render(<TablePagination page={1} totalPages={1} total={2} onPageChange={vi.fn()} />);
    expect(screen.getByText(/共/)).toHaveTextContent('共 2 条记录');
    for (const name of ['首页', '上一页', '下一页', '末页', '跳转']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('跳至页码')).not.toBeInTheDocument();
  });
});

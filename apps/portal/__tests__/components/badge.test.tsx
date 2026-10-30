/**
 * Badge 语义色 token 测试（H-39 回归）
 *
 * 背景（docs/design-system.md §使用规则 / H-39）：TSX 中禁止硬编码调色板类
 * （如 `bg-green-100` / `text-green-800`），必须引用设计系统 token。
 * 状态徽章改由 `globals.css` 的 `--color-badge-*` token 驱动。
 *
 * @req H-39
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';

describe('Badge 语义 token（H-39）', () => {
  it('success 变体使用 badge token，不再硬编码调色板类', () => {
    const { container } = render(<Badge variant="success">正常</Badge>);
    const el = container.querySelector('[data-slot="badge"]') as HTMLElement;
    expect(el.className).toContain('bg-badge-success-bg');
    expect(el.className).toContain('text-badge-success-fg');
    expect(el.className).not.toMatch(/\b(bg|text)-(green|yellow|red|blue|slate)-/);
  });

  it('warning 变体使用 badge token，不再硬编码调色板类', () => {
    const { container } = render(<Badge variant="warning">待处理</Badge>);
    const el = container.querySelector('[data-slot="badge"]') as HTMLElement;
    expect(el.className).toContain('bg-badge-warning-bg');
    expect(el.className).toContain('text-badge-warning-fg');
    expect(el.className).not.toMatch(/\b(bg|text)-(green|yellow|red|blue|slate)-/);
  });
});

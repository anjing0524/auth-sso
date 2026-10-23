/**
 * Button 焦点可见性回归守卫（U-G04）
 *
 * 背景：真实浏览器审计曾把「按钮无焦点环」列为 U-G04；二次复核发现焦点环实际存在
 * （`focus-visible:ring-2` + 150ms transition 淡入，审计取样过早导致误报）。
 * 该测试作为**回归守卫**：防止后续把焦点样式改成只写 `focus-visible:outline-none`
 * 而失去可见焦点（WCAG 2.4.7）。
 *
 * @req U-G04
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

describe('Button 焦点可见性（U-G04 回归守卫）', () => {
  it('基类保留 focus-visible ring/outline token（键盘焦点可见）', () => {
    render(<Button>保存</Button>);
    const btn = screen.getByRole('button', { name: '保存' });
    const cls = btn.className;

    // 至少一种可见焦点指示：ring 或 outline，且不是纯 outline-none
    expect(cls).toMatch(/focus-visible:(ring-2|outline-2)/);
    expect(cls).not.toMatch(/focus-visible:outline-none(?!.*focus-visible:ring)/);
  });

  it('图标按钮（icon-sm）同样保留焦点指示', () => {
    render(<Button size="icon-sm" aria-label="关闭">×</Button>);
    const btn = screen.getByRole('button', { name: '关闭' });
    expect(btn.className).toMatch(/focus-visible:(ring-2|outline-2)/);
  });
});

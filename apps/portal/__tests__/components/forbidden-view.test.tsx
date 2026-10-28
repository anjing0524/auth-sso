import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Forbidden } from '@/components/shared/forbidden';

describe('403 无权限视图', () => {
  it('使用 h1 主标题并提供返回工作台入口', () => {
    render(<Forbidden />);
    expect(screen.getByRole('heading', { level: 1, name: '无权限访问' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回工作台' })).toHaveAttribute('href', '/dashboard');
  });
});

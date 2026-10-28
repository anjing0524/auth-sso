import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RouteError } from '@/components/shared/route-error';

describe('路由错误边界', () => {
  it('使用 h1 主标题并提供重试/返回入口', () => {
    const error = Object.assign(new Error('boom'), { digest: 'err-test-1' });
    render(<RouteError error={error} reset={vi.fn()} loggerName="test" />);
    expect(screen.getByRole('heading', { level: 1, name: '页面加载出错' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('服务器在处理请求时遇到了问题');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回工作台' })).toHaveAttribute('href', '/dashboard');
  });
});

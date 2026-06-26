/**
 * CommandPalette 组件测试
 *
 * cmdk (shadcn Command) 在 jsdom 中不可用（依赖 browser subscribe API），
 * 因此 mock 掉 Command 相关组件并测试 CommandPalette 的集成逻辑。
 *
 * @req R6
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock cmdk — jsdom 中不可用
vi.mock('cmdk', () => ({
  Command: ({ children }: any) => <div>{children}</div>,
  CommandInput: (props: any) => <input placeholder="搜索功能..." {...props} />,
  CommandList: ({ children }: any) => <div>{children}</div>,
  CommandEmpty: ({ children }: any) => <div>{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: any) => (
    <button onClick={onSelect}>{children}</button>
  ),
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { CommandPalette } from '@/components/shared/command-palette';

const mockMenus = [
  { id: '1', title: '工作台', url: '/dashboard', icon: 'LayoutDashboard', children: [] },
  { id: '2', title: '用户管理', url: '/users', icon: 'Users', children: [] },
  { id: '3', title: '角色管理', url: '/roles', icon: 'ShieldCheck', children: [] },
];

// Mock CommandDialog open state
vi.mock('@/components/ui/command', () => ({
  CommandDialog: ({ children, open }: any) =>
    open ? <div data-testid="command-dialog">{children}</div> : null,
  CommandInput: (props: any) => <input placeholder="搜索功能..." {...props} />,
  CommandList: ({ children }: any) => <div>{children}</div>,
  CommandEmpty: ({ children }: any) => <div>{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: any) => <button onClick={onSelect}>{children}</button>,
}));

describe('CommandPalette', () => {
  it('Cmd+K 快捷键触发面板打开', () => {
    render(<CommandPalette menus={mockMenus} />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(screen.getByTestId('command-dialog')).toBeInTheDocument();
  });

  it('不按 Cmd+K 时面板不渲染', () => {
    render(<CommandPalette menus={mockMenus} />);

    expect(screen.queryByTestId('command-dialog')).not.toBeInTheDocument();
  });

  it('选择菜单项后调用 router.push 导航', () => {
    mockPush.mockClear();
    render(<CommandPalette menus={mockMenus} />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    // 菜单项以 button 渲染（mock 的 CommandItem），通过文本查找
    const userBtn = screen.getByRole('button', { name: '用户管理' });
    userBtn.click();

    expect(mockPush).toHaveBeenCalledWith('/users');
  });
});

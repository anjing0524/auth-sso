/**
 * cmdk 组合结构回归测试
 *
 * @req US-A-01
 */
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe('CommandDialog', () => {
  it('为输入框和菜单项提供 cmdk 根上下文', () => {
    expect(() => {
      render(
        <CommandDialog open onOpenChange={() => {}}>
          <CommandInput placeholder="搜索功能..." />
          <CommandList>
            <CommandGroup heading="导航菜单">
              <CommandItem>用户管理</CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>,
      );
    }).not.toThrow();

    expect(screen.getByPlaceholderText('搜索功能...')).toBeInTheDocument();
    expect(screen.getByText('用户管理')).toBeInTheDocument();
  });
});

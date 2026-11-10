/**
 * CommandPalette — 无障碍树兜底同步（UX-04）回归测试
 *
 * 审计现象：a11y 快照里 listbox "Suggestions" 为空。探针结论（2026-11-06）：
 * 候选项在真实 AX 树中可达（option → group → listbox 父链完整），「空 listbox」
 * 是审计快照工具不穿透 cmdk 的 [cmdk-list-sizer]（role=none）包装层所致；
 * 真实缺口是 cmdk 1.1.1 在「面板刚打开」与「输入过滤后」不更新
 * aria-activedescendant（DOM 有 aria-selected 项，listbox/combobox 属性为空）。
 *
 * 本用例钉住兜底行为：cmdk 缺失时由 MutationObserver 从 DOM 已选项同步；
 * cmdk 已设置的值不被覆盖。
 *
 * @req R6
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { CommandPalette } from '@/components/shared/command-palette';
import type * as commandModule from '@/components/ui/command';

const h = React.createElement;

/** 与真实 cmdk DOM 形状一致的 stub：list 带 cmdk-list，item 带 cmdk-item（见 cmdk 1.1.1 dist） */
function asComponentStubs<T>(stubs: { [K in keyof T]?: (props: any) => unknown }): Partial<T> {
  return stubs as Partial<T>;
}

// @allow-module-mock @/components/ui/command full-replacement: UI 原语 stub，本文件测的是 aria-activedescendant 兜底同步
vi.mock(import('@/components/ui/command'), (): Partial<typeof commandModule> =>
  asComponentStubs<typeof commandModule>({
    CommandDialog: ({ children, open }: any) =>
      open ? <div data-testid="command-dialog">{children}</div> : null,
    CommandInput: () => h('input', { 'cmdk-input': '', placeholder: '搜索功能...' }),
    CommandList: ({ children }: any) =>
      h('div', { 'cmdk-list': '', role: 'listbox', 'aria-label': 'Suggestions' }, children),
    CommandEmpty: ({ children }: any) => <div>{children}</div>,
    CommandGroup: ({ children }: any) => <div>{children}</div>,
    // cmdk 的 item id 是 useId 产物；stub 里用文本生成稳定 id
    CommandItem: ({ children, onSelect }: any) =>
      h(
        'div',
        {
          'cmdk-item': '',
          role: 'option',
          'aria-selected': 'false',
          onClick: onSelect,
          ref: (el: HTMLDivElement | null) => {
            if (el && !el.id) el.id = `opt-${el.textContent}`;
          },
        },
        children,
      ),
  }),
);

const mockMenus = [
  { id: '1', title: '工作台', url: '/dashboard', icon: null, children: [] },
  { id: '2', title: '用户管理', url: '/users', icon: null, children: [] },
];

function openPalette() {
  render(<CommandPalette menus={mockMenus} />);
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  expect(screen.getByTestId('command-dialog')).toBeInTheDocument();
}

describe('CommandPalette aria-activedescendant 兜底同步（UX-04）', () => {
  it('面板打开后候选项被选中时，listbox 与 combobox 同步 aria-activedescendant', async () => {
    openPalette();

    const list = document.querySelector('[cmdk-list]')!;
    const firstItem = document.querySelector('[cmdk-item]')! as HTMLElement;
    expect(firstItem).toBeTruthy();

    // 模拟 cmdk 初始选中（DOM 有 aria-selected，但 listbox 缺 aria-activedescendant —— 被测缺口）
    firstItem.setAttribute('aria-selected', 'true');

    await waitFor(() => {
      expect(list.getAttribute('aria-activedescendant')).toBe(firstItem.id);
    });
    expect(
      document.querySelector('[cmdk-input]')!.getAttribute('aria-activedescendant'),
    ).toBe(firstItem.id);
  });

  it('cmdk 自身已设置的 aria-activedescendant 不被兜底覆盖', async () => {
    openPalette();

    const list = document.querySelector('[cmdk-list]')!;
    const items = document.querySelectorAll('[cmdk-item]');
    const secondItem = items[1]! as HTMLElement;

    // 模拟用户导航：cmdk 正常写入了 aria-activedescendant
    list.setAttribute('aria-activedescendant', secondItem.id);
    document.querySelector('[cmdk-input]')!.setAttribute('aria-activedescendant', secondItem.id);
    secondItem.setAttribute('aria-selected', 'true');

    // 等一个宏任务让 MutationObserver 有机会触发（不应覆盖）
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(list.getAttribute('aria-activedescendant')).toBe(secondItem.id);
    expect(
      document.querySelector('[cmdk-input]')!.getAttribute('aria-activedescendant'),
    ).toBe(secondItem.id);
  });

  it('面板关闭后不再监听 DOM 变化', async () => {
    openPalette();

    // 再按一次 Cmd+K 关闭面板（Escape 由被 mock 的 Dialog 处理，不走本组件；
    // toggle 有 200ms 防抖，需等待间隔后再触发）
    await new Promise((resolve) => setTimeout(resolve, 250));
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.queryByTestId('command-dialog')).not.toBeInTheDocument();
    });

    // 关闭后对 aria-selected 的变更不应触发同步（observer 已断开；无面板 DOM，也无副作用）
    const firstItem = document.querySelector('[cmdk-item]') as HTMLElement | null;
    if (firstItem) firstItem.setAttribute('aria-selected', 'true');
    const list = document.querySelector('[cmdk-list]') as HTMLElement | null;
    if (list) expect(list.getAttribute('aria-activedescendant')).toBeNull();
  });
});

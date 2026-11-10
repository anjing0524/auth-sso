'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList,
} from '@/components/ui/command';
import { DynamicIcon } from '@/lib/icon-map';
import { UNSAVED_NAVIGATION_EVENT } from '@/hooks/use-unsaved-changes-guard';

interface MenuItem {
  id: string; title: string; url: string; icon?: string | null;
  children?: MenuItem[];
}

/**
 * aria-activedescendant 兜底同步（UX-04）。
 *
 * cmdk 1.1.1 只在「用户导航触发 value 变化」的渲染路径里更新 selectedItemId，
 * 两个场景会缺失：① 面板刚打开（初始选中项由 item 注册时静默写入）；② 输入
 * 过滤后（候选项重新挂载，value 未变则不重算）。届时 DOM 里 [aria-selected=true]
 * 的项存在，但 listbox/combobox 上的 aria-activedescendant 为空 —— 读屏用户
 * 听不到当前高亮项，「上下方向键选择、回车打开」的宣称能力不可验证。
 *
 * 兜底策略：cmdk 自己设置的值优先（用户导航后由 React 正常接管），缺失时才从
 * DOM 的已选项同步到 [cmdk-list] 与 [cmdk-input]。
 */
function syncActiveDescendant() {
  const list = document.querySelector('[cmdk-list]');
  if (!list || list.getAttribute('aria-activedescendant')) return;
  const selected = list.querySelector('[cmdk-item][aria-selected="true"]');
  if (!selected?.id) return;
  list.setAttribute('aria-activedescendant', selected.id);
  document.querySelector('[cmdk-input]')?.setAttribute('aria-activedescendant', selected.id);
}

export function CommandPalette({ menus }: { menus: MenuItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else {
      const previous = previousFocusRef.current;
      const target = previous && previous !== document.body ? previous : document.getElementById('command-palette-trigger');
      requestAnimationFrame(() => target?.focus());
    }
    setOpen(next);
  }, []);

  const toggle = useCallback(() => {
    // 200ms debounce to prevent double-tap flicker
    if (debounceTimerRef.current) return;
    handleOpenChange(!open);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
    }, 200);
  }, [handleOpenChange, open]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // 已有其他模态（弹窗）打开时不让全局命令面板叠加到其上
        if (!open && document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        toggle();
      }
    };
    // 顶栏触发器：让不熟悉快捷键的鼠标/触屏用户也能打开
    const openPalette = () => setOpen(true);
    document.addEventListener('keydown', down);
    window.addEventListener('open-command-palette', openPalette);
    return () => {
      document.removeEventListener('keydown', down);
      window.removeEventListener('open-command-palette', openPalette);
    };
  }, [toggle, open]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // UX-04：面板打开期间兜底同步 aria-activedescendant。观察两类变更：
  // - aria-selected：cmdk 给候选项应用选中态（打开时的初始选中）
  // - childList：过滤时候选项挂载/卸载（选中项可能未变、无 aria-selected 变更）
  // attributeFilter 限定只观察该属性，面板关闭即断开
  useEffect(() => {
    if (!open) return;
    syncActiveDescendant();
    const observer = new MutationObserver(syncActiveDescendant);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
    return () => observer.disconnect();
  }, [open]);

  const handleSelect = useCallback((url: string) => {
    setOpen(false); // 立即关闭面板
    // 先让未保存守卫决定是否拦截；未拦截才真正导航
    const request = new CustomEvent(UNSAVED_NAVIGATION_EVENT, { detail: url, cancelable: true });
    window.dispatchEvent(request);
    if (request.defaultPrevented) return;
    router.push(url); // 不等动画
  }, [router]);

  // Helpers to flatten nested menus (recursive for arbitrary depth)
  const flattenMenus = (items: MenuItem[], prefix = ''): { id: string; title: string; url: string; icon?: string | null }[] =>
    items.flatMap(m => {
      const label = prefix ? `${prefix} > ${m.title}` : m.title;
      const current = { id: m.id, title: label, url: m.url, icon: m.icon };
      return m.children?.length
        ? [current, ...flattenMenus(m.children, label)]
        : [current];
    });

  // 按 title 字母排序（菜单层级已保留路径前缀作为上下文）
  const flatMenus = [...flattenMenus(menus)].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="命令面板"
      description="搜索页面或功能，使用上下方向键选择，回车打开。"
    >
      <CommandInput placeholder="搜索页面、功能或操作" />
      <CommandList>
        <CommandEmpty>
          <div className="py-6 text-center text-sm text-muted-foreground">
            未找到匹配的功能
          </div>
        </CommandEmpty>
        <CommandGroup heading="导航菜单">
          {flatMenus.map(item => (
            <CommandItem key={item.id} onSelect={() => handleSelect(item.url)}>
              {item.icon ? <DynamicIcon name={item.icon} className="mr-2 h-4 w-4 opacity-50" /> : null}
              <span>{item.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

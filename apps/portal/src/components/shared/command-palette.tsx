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

export function CommandPalette({ menus }: { menus: MenuItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const toggle = useCallback(() => {
    // 200ms debounce to prevent double-tap flicker
    if (debounceTimerRef.current) return;
    setOpen(prev => !prev);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
    }, 200);
  }, []);

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

  const handleOpenChange = (next: boolean) => {
    if (next) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else {
      const previous = previousFocusRef.current;
      const target = previous && previous !== document.body ? previous : document.getElementById('command-palette-trigger');
      requestAnimationFrame(() => target?.focus());
    }
    setOpen(next);
  };

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput placeholder="搜索功能..." />
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

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList,
} from '@/components/ui/command';
import { ICON_MAP } from '@/lib/icon-map';

interface MenuItem {
  id: string; title: string; url: string; icon?: string | null;
  children?: MenuItem[];
}

export function CommandPalette({ menus }: { menus: MenuItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [toggle]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const handleSelect = useCallback((url: string) => {
    setOpen(false); // 立即关闭面板
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
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="搜索功能..." />
      <CommandList>
        <CommandEmpty>
          <div className="py-6 text-center text-sm text-muted-foreground">
            未找到匹配的功能
          </div>
        </CommandEmpty>
        <CommandGroup heading="导航菜单">
          {flatMenus.map(item => {
            const IconComponent = item.icon ? ICON_MAP[item.icon] : null;
            return (
              <CommandItem key={item.id} onSelect={() => handleSelect(item.url)}>
                {IconComponent && <IconComponent className="mr-2 h-4 w-4 opacity-50" />}
                <span>{item.title}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList,
} from '@/components/ui/command';

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

  // Helpers to flatten nested menus
  const flatMenus = menus.flatMap(m =>
    m.children?.length
      ? [{ id: m.id, title: m.title, url: m.url }, ...m.children.map(c => ({ id: c.id, title: `${m.title} > ${c.title}`, url: c.url }))]
      : [{ id: m.id, title: m.title, url: m.url }]
  );

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
          {flatMenus.map(item => (
            <CommandItem key={item.id} onSelect={() => handleSelect(item.url)}>
              <span>{item.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

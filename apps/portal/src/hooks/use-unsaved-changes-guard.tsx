'use client';

/**
 * 未保存修改离开守卫：拦截站内链接点击 + 浏览器刷新/关闭。
 *
 * 现有编辑页只显示「未保存的修改」；用户点侧栏/返回会静默丢失输入。
 * 这里用统一确认弹窗（不使用原生 confirm），确认后走 router.push。
 * 注：浏览器前进/后退（popstate）不在本守卫范围，刷新/关闭由 beforeunload 兜底。
 */
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function useUnsavedChangesGuard(isDirty: boolean): React.ReactNode {
  const dirtyRef = useRef(isDirty);
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('/api/')) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <Dialog open={pendingHref !== null} onOpenChange={(open) => { if (!open) setPendingHref(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>离开并放弃未保存的修改？</DialogTitle>
          <DialogDescription>当前页面有未保存的修改，离开后这些修改会丢失。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingHref(null)}>继续编辑</Button>
          <Button
            variant="destructive"
            onClick={() => {
              const href = pendingHref;
              setPendingHref(null);
              if (href) {
                // 先解除脏标记，避免整页导航触发 beforeunload；整页导航保证旧页面（含本弹窗）卸载
                dirtyRef.current = false;
                window.location.assign(href);
              }
            }}
          >
            放弃并离开
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

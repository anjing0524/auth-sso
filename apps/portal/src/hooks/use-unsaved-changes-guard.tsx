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

export const UNSAVED_NAVIGATION_EVENT = 'unsaved-guard:request-navigation';

export function useUnsavedChangesGuard(isDirty: boolean): React.ReactNode {
  const dirtyRef = useRef(isDirty);
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pendingHistory, setPendingHistory] = useState(false);

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

    // 非链接导航（命令面板/按钮 router.push）统一先请求守卫；未脏时不拦截。
    const onRequestNavigation = (event: Event) => {
      if (!dirtyRef.current || !event.cancelable) return;
      event.preventDefault();
      const href = (event as CustomEvent<string>).detail;
      if (href) setPendingHref(href);
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener(UNSAVED_NAVIGATION_EVENT, onRequestNavigation);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener(UNSAVED_NAVIGATION_EVENT, onRequestNavigation);
    };
  }, []);

  // 历史哨兵：脏时在当前位置再压一条同 URL 记录；后退先落到同 URL，拦下后弹确认。
  useEffect(() => {
    if (!isDirty) return;
    const sentinel = { ...(window.history.state ?? {}), __dirtyGuard: true };
    window.history.pushState(sentinel, '', window.location.href);
    const onPopState = () => {
      if (!dirtyRef.current) return;
      setPendingHistory(true);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isDirty]);

  // 保存后移除哨兵（同 URL 后退一次），避免下一次 Back 空点。
  useEffect(() => {
    if (isDirty) return;
    if (window.history.state?.__dirtyGuard) window.history.back();
  }, [isDirty]);

  return (
    <Dialog open={pendingHref !== null || pendingHistory} onOpenChange={(open) => { if (!open) { setPendingHref(null); setPendingHistory(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>离开并放弃未保存的修改？</DialogTitle>
          <DialogDescription>当前页面有未保存的修改，离开后这些修改会丢失。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (pendingHistory) {
                window.history.pushState({ ...(window.history.state ?? {}), __dirtyGuard: true }, '', window.location.href);
              }
              setPendingHref(null);
              setPendingHistory(false);
            }}
          >
            继续编辑
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const href = pendingHref;
              const wasHistory = pendingHistory;
              setPendingHref(null);
              setPendingHistory(false);
              if (wasHistory) {
                dirtyRef.current = false;
                window.history.back();
              } else if (href) {
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

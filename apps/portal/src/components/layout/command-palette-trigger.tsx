'use client';

/**
 * 命令面板触发按钮（顶栏）。
 *
 * 之前顶栏只有一枚静态 `<kbd>⌘K</kbd>`：键盘用户能触发，鼠标/触屏用户
 * 完全不知道也点不了——典型的"死提示"。现在它是真正的按钮（aria-label），
 * 点击派发自定义事件打开 CommandPalette；小屏仅显示图标，仍可点。
 */
import { Search } from 'lucide-react';

export function CommandPaletteTrigger() {
  return (
    <button
      id="command-palette-trigger"
      type="button"
      aria-label="搜索功能（Ctrl 或 Command + K）"
      title="搜索功能（Ctrl / ⌘ + K）"
      onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
    >
      <Search className="h-3.5 w-3.5" />
      <kbd className="hidden select-none sm:inline">K</kbd>
    </button>
  );
}

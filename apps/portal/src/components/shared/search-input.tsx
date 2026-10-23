/**
 * SearchInput — 列表页统一搜索框（图标 + 输入框 + 清空按钮 + 一致尺寸）
 *
 * 统一口径：宽度默认 `w-full md:w-80`；高度 40px（Input 基类）；圆角 8px；
 * 带图标与「清空」按钮（有值时出现），清空按钮 aria-label 固定，便于测试与读屏。
 */
import { Loader2, Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  /** 服务端查询进行中（配合 300ms 防抖，给出可见反馈） */
  busy?: boolean;
}

export function SearchInput({ value, onChange, placeholder, className, busy = false }: SearchInputProps) {
  return (
    <div className={cn('relative w-full md:w-64', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
      />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        aria-busy={busy || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        className="h-8 pl-8 pr-8 text-[13px]"
      />
      {busy ? (
        <Loader2
          aria-hidden="true"
          className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      ) : value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

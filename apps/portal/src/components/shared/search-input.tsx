/**
 * SearchInput — 列表页统一搜索框（图标 + 输入框 + 清空按钮 + 一致尺寸）
 *
 * 统一口径：宽度默认 `w-full md:w-80`；高度 40px（Input 基类）；圆角 8px；
 * 带图标与「清空」按钮（有值时出现），清空按钮 aria-label 固定，便于测试与读屏。
 */
import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  return (
    <div className={cn('relative w-full md:w-80', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
      />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-9"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

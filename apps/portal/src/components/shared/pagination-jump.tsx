'use client';

/**
 * 分页跳页输入（仅客户端列表使用）。
 *
 * 存在理由：规模数据下只有「上一页/下一页」时，201 用户=14 页、5251 条审计=351 页，
 * 想回到中间某页只能连点几十次。这个小组件让用户直接输入页码并跳转；
 * 服务端列表（审计日志）走同构的 GET form，不需要 JS。
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function PaginationJump({
  totalPages,
  onPageChange,
}: {
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return;
    onPageChange(Math.min(Math.max(1, n), totalPages));
    setValue('');
  };
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <label htmlFor="pagination-jump" className="sr-only">跳至页码</label>
      <Input
        id="pagination-jump"
        name="page"
        type="number"
        min={1}
        max={totalPages}
        inputMode="numeric"
        data-compact="true"
        placeholder="页码"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-16 px-2 text-xs"
      />
      <Button type="submit" variant="outline" size="sm" className="h-8 px-2 text-xs" aria-label="跳转">
        跳转
      </Button>
    </form>
  );
}

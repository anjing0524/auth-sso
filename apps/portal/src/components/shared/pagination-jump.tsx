'use client';

/**
 * 分页跳页输入（仅客户端列表使用）— U-G01
 *
 * 存在理由：规模数据下只有「上一页/下一页」时，201 用户=14 页、5251 条审计=351 页，
 * 想回到中间某页只能连点几十次。这个小组件让用户直接输入页码并跳转；
 * 服务端列表（审计日志）走同构的 GET form（见 `pagination-jump-form.tsx`）。
 *
 * 2026-10-23 修复（真实浏览器审计 U-G01）：此前输入框带 `min/max`，越界值（0/999）
 * 会被浏览器约束校验**静默拦截**——点「跳转」毫无反应。现在：
 * - 去掉原生 min/max，form 加 `noValidate`；
 * - 提交时用 `clampJumpPage` 钳制，并渲染可见的 `role="status"` / `aria-live` 提示。
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clampJumpPage } from './pagination-clamp';

const JUMP_INPUT_ID = 'pagination-jump';
const JUMP_NOTICE_ID = `${JUMP_INPUT_ID}-notice`;

export function PaginationJump({
  totalPages,
  onPageChange,
}: {
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState('');

  const submit = () => {
    const decision = clampJumpPage(value, totalPages);
    setNotice(decision.notice ?? '');
    if (!decision.navigate) return;
    onPageChange(decision.page);
    setValue('');
  };

  return (
    <form
      noValidate
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={JUMP_INPUT_ID} className="sr-only">跳至页码</label>
      <Input
        id={JUMP_INPUT_ID}
        name="page"
        type="number"
        inputMode="numeric"
        data-compact="true"
        placeholder="页码"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (notice) setNotice('');
        }}
        aria-describedby={notice ? JUMP_NOTICE_ID : undefined}
        className="h-8 w-16 px-2 text-xs"
      />
      <Button type="submit" variant="outline" size="sm" className="h-8 px-2 text-xs" aria-label="跳转">
        跳转
      </Button>
      {notice ? (
        <p
          id={JUMP_NOTICE_ID}
          role="status"
          aria-live="polite"
          data-jump-notice
          className="max-w-64 text-[11px] leading-tight text-muted-foreground"
        >
          {notice}
        </p>
      ) : null}
    </form>
  );
}

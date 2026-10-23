'use client';

/**
 * 服务端列表的跳页表单（GET form + JS clamp + aria-live 提示）— U-G01
 *
 * 背景：审计日志等 Server Component 列表的跳页原先是一个带 `min/max` 的原生 GET form；
 * 浏览器约束校验会**静默拦截**越界提交（输入 999 点「跳转」毫无反应）。
 *
 * 现在：
 * - 去掉 `min/max`，保留 `method="get"` 与隐藏参数（无 JS 时仍可渐进使用）；
 * - JS 路径在提交时 clamp 到 [1, totalPages] 并给出可见 `role="status"` 提示；
 * - 导航通过可注入的 `navigate`（默认 `window.location.assign`）完成，便于组件测试。
 */
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clampJumpPage } from './pagination-clamp';

export interface PaginationJumpFormProps {
  /** GET 提交目标（如 `/audit-logs`） */
  action: string;
  totalPages: number;
  /** 需要随跳页保留的其它查询参数（如 `tab`） */
  params?: Record<string, string>;
  /** 当前页码（作为输入初始值） */
  page: number;
  /** 导航注入点（测试用）；默认整页跳转 */
  navigate?: (url: string) => void;
}

const JUMP_INPUT_ID = 'pagination-jump-form';
const JUMP_NOTICE_ID = `${JUMP_INPUT_ID}-notice`;

function defaultNavigate(url: string) {
  window.location.assign(url);
}

export function PaginationJumpForm({ action, totalPages, params, page, navigate = defaultNavigate }: PaginationJumpFormProps) {
  const [value, setValue] = useState(String(page));
  const [notice, setNotice] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const decision = clampJumpPage(value, totalPages);
    setNotice(decision.notice ?? '');
    if (!decision.navigate) return;
    const query = new URLSearchParams(params ?? {});
    query.set('page', String(decision.page));
    navigate(`${action}?${query.toString()}`);
  };

  return (
    <form
      action={action}
      method="get"
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-1.5"
    >
      {Object.entries(params ?? {}).map(([key, paramValue]) => (
        <input key={key} type="hidden" name={key} value={paramValue} />
      ))}
      <label htmlFor={JUMP_INPUT_ID} className="sr-only">跳至页码</label>
      <Input
        id={JUMP_INPUT_ID}
        name="page"
        type="number"
        inputMode="numeric"
        data-compact="true"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (notice) setNotice('');
        }}
        aria-describedby={notice ? JUMP_NOTICE_ID : undefined}
        className="h-8 w-16 px-2 text-xs"
      />
      <Button type="submit" variant="outline" size="sm" className="h-8 px-2 text-xs">跳转</Button>
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

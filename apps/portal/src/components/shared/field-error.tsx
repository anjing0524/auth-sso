'use client';

/**
 * 字段级错误提示（#92 的**渲染端**形状只有这一处）
 *
 * 判定在 `useFieldFailure`（错误码 → 字段），渲染在组件里。此前这段 `<p role="alert">`
 * 在四个表单里复制了 5 份——**判定抽走了、渲染没抽**，新加一处表单就多一份。
 *
 * 用法：`<FieldError failure={fieldError} field="code" />`
 * —— `failure` 为 `null` 或落在别的字段上时不渲染任何东西。
 *
 * @module components/shared/field-error
 */
import type { FieldFailure } from '@/hooks/use-field-failure';

export function FieldError({ failure, field }: { failure: FieldFailure | null; field: string }) {
  if (!failure || failure.field !== field) return null;

  return (
    <p role="alert" className="text-xs font-medium text-destructive">
      {failure.message}
    </p>
  );
}

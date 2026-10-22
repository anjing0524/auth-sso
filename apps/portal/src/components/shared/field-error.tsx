'use client';

/**
 * 字段级错误提示（#92 的**渲染端**形状只有这一处）
 *
 * 判定在 `useFieldFailure`（错误码 → 字段），渲染在组件里。此前这段 `<p role="alert">`
 * 散落在 4 个文件共 8 处（PermissionsTable 2 / RolesTable 1 / DepartmentTree 2 /
 * CreateUserDialog 3，且字号已经在漂移：`text-sm` vs `text-xs`）——**判定抽走了、渲染没抽**。
 *
 * 用法：`<FieldError failure={fieldError} field="code" />`
 * —— `failure` 为 `null` 或落在别的字段上时不渲染任何东西。
 *
 * @module components/shared/field-error
 */
import type { ErrorField } from '@/domain/shared/error-fields';
import type { FieldFailure } from '@/hooks/use-field-failure';

export function FieldError({ failure, field }: { failure: FieldFailure | null; field: ErrorField }) {
  if (!failure || failure.field !== field) return null;

  return (
    <p role="alert" className="text-xs font-medium text-destructive">
      {failure.message}
    </p>
  );
}

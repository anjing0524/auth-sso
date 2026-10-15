'use client';

/**
 * 字段级失败处置（#92 的四处实体表单复用）
 *
 * ## 为什么是 hook 而不是每处写一遍
 *
 * #82 让服务端能报**具体**冲突码（`ROLE_ALREADY_EXISTS` / `PERMISSION_ALREADY_EXISTS` /
 * `DEPARTMENT_ALREADY_EXISTS` …），前端要把它落到**对应输入框**。
 * 三处实体表单（角色 / 权限 / 部门）与创建用户表单的处理完全同形：
 * "有映射 ⇒ 就地显示；无映射 ⇒ toast"。写四遍等于把同一个判定复制四份。
 *
 * @module hooks/use-field-failure
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { fieldForErrorCode, type ErrorField } from '@/domain/shared/error-fields';

/** 落在某个输入框上的失败 */
export interface FieldFailure {
  field: ErrorField;
  message: string;
}

/** Server Action 失败响应的最小形状（`ApiError` 的结构子集） */
export interface ActionFailure {
  error: string;
  message: string;
}

/**
 * @param renderedFields 本表单**实际渲染**的字段标识。
 *
 * 为什么必须传：错误码可能有字段映射，而**这个表单并没有那个输入框**
 * （例如 `MOBILE_ALREADY_EXISTS` 映射到 `mobile`，但创建用户表单不采集 mobile）。
 * 那种情况下若照旧"就地显示"，就会出现**无处渲染、也不弹提示**的静默失败——
 * 这与"服务端给了可判别的原因、客户端却没显示"完全一样糟。
 */
export function useFieldFailure(renderedFields: readonly string[]) {
  const [fieldError, setFieldError] = useState<FieldFailure | null>(null);

  // 依赖必须是简单表达式：把字段清单折成一个稳定字符串再进依赖数组
  const fieldsKey = renderedFields.join(',');

  /** 映射存在**且本表单有该字段** ⇒ 就地显示；否则回落到 toast（**不重复提示**） */
  const reportFailure = useCallback(
    (res: ActionFailure): void => {
      const mapped = fieldForErrorCode(res.error);
      const handled = mapped !== null && fieldsKey.split(',').includes(mapped);
      setFieldError(handled ? { field: mapped, message: res.message } : null);
      if (!handled) toast.error(res.message);
    },
    [fieldsKey],
  );

  /** 打开对话框/重新提交前清掉上一次的字段错误 */
  const clearFailure = useCallback((): void => setFieldError(null), []);

  return { fieldError, reportFailure, clearFailure };
}

import 'server-only';

import type { z } from 'zod';
import { COMMON_ERRORS, type ApiError } from '@auth-sso/contracts';

type Valid<T> = { ok: true; data: T };
/** 失败信封直接复用契约的 `ApiError`（此前这里手抄了一份，且把码写成裸 `string`） */
type Invalid = { ok: false; response: ApiError };

export function validate<T>(schema: z.ZodSchema<T>, input: unknown): Valid<T> | Invalid {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      response: {
        success: false,
        error: COMMON_ERRORS.VALIDATION_ERROR,
        message: parsed.error.issues[0]!.message,
      },
    };
  }
  return { ok: true, data: parsed.data };
}

import 'server-only';

import type { z } from 'zod';
import { COMMON_ERRORS } from '@auth-sso/contracts';

type Valid<T> = { ok: true; data: T };
type Invalid = { ok: false; response: { success: false; error: string; message: string } };

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

import 'server-only';

import { unstable_rethrow } from 'next/navigation';
import { mapDomainError } from '@/domain/shared/error-mapping';

/**
 * 保留 Next.js redirect、Request-time API 与 PPR 的框架控制流，仅映射应用错误。
 */
export function mapServerError(error: unknown) {
  unstable_rethrow(error);
  return mapDomainError(error);
}

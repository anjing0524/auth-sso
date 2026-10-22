/**
 * @req Portal framework control-flow boundary regression
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUnstableRethrow } = vi.hoisted(() => ({
  mockUnstableRethrow: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  unstable_rethrow: mockUnstableRethrow,
}));

import { mapServerError } from './server-error';

describe('mapServerError', () => {
  beforeEach(() => {
    mockUnstableRethrow.mockReset();
  });

  it('checks framework control flow before mapping application errors', () => {
    const result = mapServerError(new Error('application failure'));

    expect(mockUnstableRethrow).toHaveBeenCalledOnce();
    expect(result.status).toBe(500);
  });

  it('allows Next.js control-flow errors to propagate', () => {
    const frameworkError = new Error('framework control flow');
    mockUnstableRethrow.mockImplementationOnce(() => {
      throw frameworkError;
    });

    expect(() => mapServerError(frameworkError)).toThrow(frameworkError);
  });
});

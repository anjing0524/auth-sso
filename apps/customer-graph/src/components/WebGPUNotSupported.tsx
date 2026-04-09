'use client';

import { useEffect, useState } from 'react';

export interface WebGPUNotSupportedProps {
  reason?: string;
  browser?: string;
}

/**
 * WebGPU 不支持提示组件
 */
export function WebGPUNotSupported({
  reason,
  browser,
}: WebGPUNotSupportedProps) {
  const [recommendedBrowsers, setRecommendedBrowsers] = useState<string[]>([]);

  useEffect(() => {
    // 动态导入以避免 SSR 问题
    import('../lib/webgpu-check').then(({ getRecommendedBrowsers }) => {
      setRecommendedBrowsers(getRecommendedBrowsers());
    });
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
      <div className="max-w-md text-center">
        <div className="mb-6">
          <svg
            className="mx-auto h-16 w-16 text-yellow-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <h2 className="text-xl font-semibold mb-2">WebGPU 不支持</h2>

        <p className="text-gray-400 mb-4">
          此应用需要 WebGPU 支持才能运行。
          {reason && <span className="block mt-2 text-sm">原因: {reason}</span>}
          {browser && (
            <span className="block mt-1 text-sm">当前浏览器: {browser}</span>
          )}
        </p>

        <div className="bg-gray-800 rounded-lg p-4 text-left">
          <p className="text-sm font-medium mb-2">推荐浏览器:</p>
          <ul className="text-sm text-gray-400 space-y-1">
            {recommendedBrowsers.map((browser) => (
              <li key={browser}>• {browser}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
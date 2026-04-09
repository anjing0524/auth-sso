'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  checkWebGPUSupport,
  WebGPUSupport,
} from '../lib/webgpu-check';
import {
  createGraphEngine,
  GraphEngineWasm,
  LoadProgress,
} from '../lib/wasm-loader';
import { WebGPUNotSupported } from './WebGPUNotSupported';

export interface WasmLoaderProps {
  /** 子组件渲染函数 */
  children: (engine: GraphEngineWasm) => React.ReactNode;
  /** 加载中渲染函数 */
  fallback?: (progress: LoadProgress) => React.ReactNode;
  /** Canvas 元素引用 */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

/**
 * WASM 加载器组件
 *
 * 负责检测 WebGPU 支持、加载 WASM 模块并初始化图引擎
 */
export function WasmLoader({ children, fallback, canvasRef }: WasmLoaderProps) {
  const [webgpuSupport, setWebgpuSupport] = useState<WebGPUSupport | null>(null);
  const [engine, setEngine] = useState<GraphEngineWasm | null>(null);
  const [progress, setProgress] = useState<LoadProgress>({
    state: 'idle',
    progress: 0,
    message: '',
  });
  const [error, setError] = useState<string | null>(null);

  // 检测 WebGPU 支持
  useEffect(() => {
    checkWebGPUSupport().then(setWebgpuSupport);
  }, []);

  // 初始化引擎
  const initializeEngine = useCallback(async () => {
    if (!canvasRef.current || !webgpuSupport?.supported) return;

    try {
      const graphEngine = await createGraphEngine(
        canvasRef.current,
        setProgress
      );
      setEngine(graphEngine);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setProgress({
        state: 'error',
        progress: 0,
        message: 'Failed to initialize',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [canvasRef, webgpuSupport]);

  // 当 WebGPU 支持确认后初始化
  useEffect(() => {
    if (webgpuSupport?.supported && canvasRef.current) {
      initializeEngine();
    }
  }, [webgpuSupport, canvasRef, initializeEngine]);

  // 清理
  useEffect(() => {
    return () => {
      if (engine) {
        engine.destroy();
      }
    };
  }, [engine]);

  // WebGPU 不支持
  if (webgpuSupport && !webgpuSupport.supported) {
    return (
      <WebGPUNotSupported
        reason={webgpuSupport.reason}
        browser={webgpuSupport.browser}
      />
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <div className="max-w-md text-center">
          <div className="mb-6">
            <svg
              className="mx-auto h-16 w-16 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">加载失败</h2>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={initializeEngine}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // 加载中
  if (!engine) {
    if (fallback) {
      return fallback(progress);
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <div className="w-full max-w-xs">
          {/* 进度条 */}
          <div className="mb-4">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>

          {/* 状态消息 */}
          <p className="text-center text-sm text-gray-400">
            {progress.message || 'Loading...'}
          </p>

          {/* 检测 WebGPU 中 */}
          {progress.state === 'idle' && (
            <p className="text-center text-xs text-gray-500 mt-2">
              Checking WebGPU support...
            </p>
          )}
        </div>
      </div>
    );
  }

  // 渲染子组件
  return <>{children(engine)}</>;
}
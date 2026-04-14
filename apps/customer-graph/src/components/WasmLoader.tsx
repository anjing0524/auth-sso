'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
}

/**
 * WASM 加载器组件
 *
 * 负责检测 WebGPU 支持、加载 WASM 模块并初始化图引擎
 */
export function WasmLoader({ children, fallback }: WasmLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    checkWebGPUSupport()
      .then(setWebgpuSupport)
      .catch((err) => {
        console.error('[WasmLoader] WebGPU check failed:', err);
        setWebgpuSupport({
          supported: false,
          reason: err instanceof Error ? err.message : 'WebGPU check failed',
        });
      });
  }, []);

  // 初始化引擎
  const initializeEngine = useCallback(async () => {
    if (!canvasRef.current) {
      console.log('[WasmLoader] Canvas not ready');
      return;
    }
    if (!webgpuSupport?.supported) {
      console.log('[WasmLoader] WebGPU not supported');
      return;
    }

    try {
      console.log('[WasmLoader] Starting engine initialization...');
      const graphEngine = await createGraphEngine(
        canvasRef.current,
        setProgress
      );
      console.log('[WasmLoader] Engine initialized successfully');
      setEngine(graphEngine);
    } catch (err) {
      console.error('[WasmLoader] Engine init failed:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setProgress({
        state: 'error',
        progress: 0,
        message: 'Failed to initialize',
        error: errorMsg,
      });
    }
  }, [webgpuSupport]);

  // 当 WebGPU 支持确认后初始化
  useEffect(() => {
    if (webgpuSupport?.supported && canvasRef.current) {
      initializeEngine();
    }
  }, [webgpuSupport, initializeEngine]);

  // 清理
  useEffect(() => {
    return () => {
      if (engine) {
        try {
          engine.destroy();
        } catch (err) {
          console.error('[WasmLoader] Destroy failed:', err);
        }
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

  // 始终渲染 canvas（引擎需要它）
  // 加载时显示 loading UI 覆盖在上面，加载完成后显示 children
  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
      {!engine && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950">
          {fallback ? (
            fallback(progress)
          ) : (
            <div className="flex flex-col items-center justify-center p-8">
              <div className="w-full max-w-xs mb-4">
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
              </div>
              <p className="text-sm text-gray-400">
                {progress.message || 'Loading...'}
              </p>
            </div>
          )}
        </div>
      )}
      {engine && children(engine)}
    </div>
  );
}
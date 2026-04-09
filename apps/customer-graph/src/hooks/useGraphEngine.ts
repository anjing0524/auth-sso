import { useRef, useEffect, useCallback } from 'react';
import { GraphEngineWasm } from '../lib/wasm-loader';

export interface UseGraphEngineOptions {
  /** 图引擎实例 */
  engine: GraphEngineWasm | null;
  /** 是否自动运行动画循环 */
  autoRender?: boolean;
  /** 每帧是否执行模拟步骤 */
  autoSimulate?: boolean;
  /** 模拟帧率限制 */
  simulationRate?: number;
}

export interface UseGraphEngineReturn {
  /** 执行一次模拟步骤 */
  stepSimulation: () => void;
  /** 渲染一帧 */
  render: () => void;
  /** 开始动画循环 */
  startAnimation: () => void;
  /** 停止动画循环 */
  stopAnimation: () => void;
  /** 重置视口 */
  resetViewport: () => void;
  /** 适配视图 */
  fitToView: (padding?: number) => void;
}

/**
 * 图引擎 React Hook
 *
 * 管理图引擎的动画循环和交互
 */
export function useGraphEngine({
  engine,
  autoRender = true,
  autoSimulate = true,
  simulationRate = 60,
}: UseGraphEngineOptions): UseGraphEngineReturn {
  const animationRef = useRef<number | null>(null);
  const lastSimTimeRef = useRef<number>(0);
  const isRunningRef = useRef(false);

  // 执行一次模拟步骤
  const stepSimulation = useCallback(() => {
    if (engine) {
      engine.step_simulation();
    }
  }, [engine]);

  // 渲染一帧
  const render = useCallback(() => {
    if (engine) {
      engine.render();
    }
  }, [engine]);

  // 动画循环
  const animate = useCallback(
    (timestamp: number) => {
      if (!engine || !isRunningRef.current) return;

      // 执行模拟步骤（限制帧率）
      if (autoSimulate) {
        const elapsed = timestamp - lastSimTimeRef.current;
        const targetInterval = 1000 / simulationRate;

        if (elapsed >= targetInterval) {
          engine.step_simulation();
          lastSimTimeRef.current = timestamp;
        }
      }

      // 渲染
      if (autoRender) {
        engine.render();
      }

      // 继续循环
      animationRef.current = requestAnimationFrame(animate);
    },
    [engine, autoRender, autoSimulate, simulationRate]
  );

  // 开始动画循环
  const startAnimation = useCallback(() => {
    if (!engine) return;

    isRunningRef.current = true;
    lastSimTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(animate);
  }, [engine, animate]);

  // 停止动画循环
  const stopAnimation = useCallback(() => {
    isRunningRef.current = false;
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  // 重置视口
  const resetViewport = useCallback(() => {
    if (engine) {
      engine.reset_viewport();
    }
  }, [engine]);

  // 适配视图
  const fitToView = useCallback(
    (padding = 50) => {
      if (engine) {
        engine.fit_to_view(padding);
      }
    },
    [engine]
  );

  // 引擎变化时重新启动动画
  useEffect(() => {
    if (engine && isRunningRef.current) {
      startAnimation();
    }

    return () => {
      stopAnimation();
    };
  }, [engine, startAnimation, stopAnimation]);

  // 清理
  useEffect(() => {
    return () => {
      stopAnimation();
    };
  }, [stopAnimation]);

  return {
    stepSimulation,
    render,
    startAnimation,
    stopAnimation,
    resetViewport,
    fitToView,
  };
}
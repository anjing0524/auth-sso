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

  // 使用 ref 存储 engine 和配置，避免 animate 函数依赖变化
  const engineRef = useRef(engine);
  const autoRenderRef = useRef(autoRender);
  const autoSimulateRef = useRef(autoSimulate);
  const simulationRateRef = useRef(simulationRate);

  // 更新 refs
  useEffect(() => {
    engineRef.current = engine;
    autoRenderRef.current = autoRender;
    autoSimulateRef.current = autoSimulate;
    simulationRateRef.current = simulationRate;
  }, [engine, autoRender, autoSimulate, simulationRate]);

  // 执行一次模拟步骤
  const stepSimulation = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.step_simulation();
    }
  }, []);

  // 渲染一帧
  const render = useCallback(() => {
    if (engineRef.current) {
      // 跳过没有数据的渲染
      const nodeCount = engineRef.current.get_node_count();
      if (nodeCount === 0) {
        return;
      }
      engineRef.current.render();
    }
  }, []);

  // 动画循环 - 使用 ref 引用自身，避免依赖问题
  const animateRef = useRef<((timestamp: number) => void) | null>(null);

  useEffect(() => {
    animateRef.current = (timestamp: number) => {
      const currentEngine = engineRef.current;
      if (!currentEngine || !isRunningRef.current) return;

      // 执行模拟步骤（限制帧率）
      if (autoSimulateRef.current) {
        const elapsed = timestamp - lastSimTimeRef.current;
        const targetInterval = 1000 / simulationRateRef.current;

        if (elapsed >= targetInterval) {
          currentEngine.step_simulation();
          lastSimTimeRef.current = timestamp;
        }
      }

      // 渲染
      if (autoRenderRef.current) {
        // 跳过没有数据的渲染
        if (currentEngine.get_node_count() > 0) {
          currentEngine.render();
        }
      }

      // 继续循环
      animationRef.current = requestAnimationFrame((ts) => animateRef.current?.(ts));
    };
  }, []);

  // 开始动画循环
  const startAnimation = useCallback(() => {
    if (!engineRef.current) return;

    isRunningRef.current = true;
    lastSimTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame((ts) => animateRef.current?.(ts));
  }, []);

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
    if (engineRef.current) {
      engineRef.current.reset_viewport();
    }
  }, []);

  // 适配视图
  const fitToView = useCallback((padding = 50) => {
    if (engineRef.current) {
      engineRef.current.fit_to_view(padding);
    }
  }, []);

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
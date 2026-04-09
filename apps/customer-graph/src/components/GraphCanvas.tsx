'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { GraphEngineWasm } from '../lib/wasm-loader';
import { useGraphEngine } from '../hooks/useGraphEngine';

export interface GraphCanvasProps {
  /** 图引擎实例 */
  engine: GraphEngineWasm;
  /** Canvas 类名 */
  className?: string;
  /** 是否自动开始模拟 */
  autoSimulate?: boolean;
  /** 初始数据加载回调 */
  onDataLoad?: () => void;
  /** 节点点击回调 */
  onNodeClick?: (nodeId: number | null) => void;
}

/**
 * 图可视化 Canvas 组件
 *
 * 托管 WASM 驱动的 WebGPU Canvas，处理交互事件
 */
export function GraphCanvas({
  engine,
  className = '',
  autoSimulate = true,
  onNodeClick,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);

  // 使用图引擎 Hook
  const { startAnimation, stopAnimation, fitToView } = useGraphEngine({
    engine,
    autoRender: true,
    autoSimulate,
  });

  // 处理 Canvas 尺寸变化
  const handleResize = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const { width, height } = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // 设置 Canvas 尺寸
    canvasRef.current.width = width * dpr;
    canvasRef.current.height = height * dpr;
    canvasRef.current.style.width = `${width}px`;
    canvasRef.current.style.height = `${height}px`;

    // 通知引擎
    engine.resize(width, height);
  }, [engine]);

  // 初始化
  useEffect(() => {
    if (!engine) return;

    // 设置初始尺寸
    handleResize();

    // 开始动画循环
    startAnimation();

    // 适配视图
    setTimeout(() => {
      fitToView(50);
    }, 100);

    return () => {
      stopAnimation();
    };
  }, [engine, handleResize, startAnimation, stopAnimation, fitToView]);

  // 监听容器尺寸变化
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [handleResize]);

  // 鼠标事件处理
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 左键：选择/拖动
      // 右键/中键：平移
      const button = e.button;

      engine.on_mouse_down(x, y, button);

      if (button === 0) {
        // 左键：检查是否点击了节点
        const nodeId = engine.get_hovered_node(x, y);
        if (nodeId >= 0) {
          setIsDragging(true);
          setHoveredNode(nodeId);
        }
      }

      e.preventDefault();
    },
    [engine]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      engine.on_mouse_move(x, y);

      // 更新悬停状态
      if (!isDragging) {
        const nodeId = engine.get_hovered_node(x, y);
        setHoveredNode(nodeId >= 0 ? nodeId : null);
      }

      // 更新 Canvas 光标
      if (canvasRef.current) {
        if (isDragging) {
          canvasRef.current.style.cursor = 'grabbing';
        } else if (hoveredNode !== null) {
          canvasRef.current.style.cursor = 'pointer';
        } else {
          canvasRef.current.style.cursor = 'default';
        }
      }
    },
    [engine, isDragging, hoveredNode]
  );

  const handleMouseUp = useCallback(
    () => {
      engine.on_mouse_up();
      setIsDragging(false);

      // 触发点击回调
      if (hoveredNode !== null && onNodeClick) {
        onNodeClick(hoveredNode);
      }
    },
    [engine, hoveredNode, onNodeClick]
  );

  const handleMouseLeave = useCallback(() => {
    engine.on_mouse_up();
    setIsDragging(false);
    setHoveredNode(null);
  }, [engine]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      engine.on_wheel(e.deltaY, x, y);
      e.preventDefault();
    },
    [engine]
  );

  // 键盘事件处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          // 取消选择
          engine.select_node(null);
          onNodeClick?.(null);
          break;
        case 'r':
        case 'R':
          // 重置视图
          engine.reset_viewport();
          break;
        case 'f':
        case 'F':
          // 适配视图
          fitToView(50);
          break;
      }
    },
    [engine, fitToView, onNodeClick]
  );

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full ${className}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full outline-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* 悬停节点提示 */}
      {hoveredNode !== null && !isDragging && (
        <div className="absolute top-2 left-2 bg-gray-800/80 text-xs px-2 py-1 rounded text-gray-300">
          Node {hoveredNode}
        </div>
      )}

      {/* 快捷键提示 */}
      <div className="absolute bottom-2 right-2 text-xs text-gray-500">
        <span className="mr-2">R: 重置</span>
        <span className="mr-2">F: 适配</span>
        <span>ESC: 取消选择</span>
      </div>
    </div>
  );
}
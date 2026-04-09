'use client';

import { useRef, useState, useCallback } from 'react';
import { WasmLoader } from '@/components/WasmLoader';
import { GraphCanvas } from '@/components/GraphCanvas';
import { GraphEngineWasm, LoadProgress } from '@/lib/wasm-loader';

// 演示数据生成
function generateDemoData(nodeCount: number) {
  const nodes = [];
  const edges = [];

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      x: (Math.random() - 0.5) * 800,
      y: (Math.random() - 0.5) * 600,
      vx: 0,
      vy: 0,
      radius: 5 + Math.random() * 10,
      color_r: 0.3 + Math.random() * 0.4,
      color_g: 0.5 + Math.random() * 0.3,
      color_b: 0.7 + Math.random() * 0.3,
      color_a: 0.9,
      node_id: i,
      degree: 0,
    });
  }

  // 生成随机边
  const edgeCount = Math.floor(nodeCount * 1.5);
  for (let i = 0; i < edgeCount; i++) {
    const source = Math.floor(Math.random() * nodeCount);
    const target = Math.floor(Math.random() * nodeCount);
    if (source !== target) {
      edges.push({
        source_id: source,
        target_id: target,
        color_r: 0.4,
        color_g: 0.4,
        color_b: 0.5,
        color_a: 0.5,
        weight: 1.0,
        edge_type: 0,
      });
    }
  }

  return { nodes, edges };
}

// 加载中组件
function LoadingScreen({ progress }: { progress: LoadProgress }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-8">Customer Graph</h1>

      <div className="w-full max-w-xs mb-4">
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress.progress}%` }}
          />
        </div>
      </div>

      <p className="text-gray-400">{progress.message || 'Loading...'}</p>
    </div>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<GraphEngineWasm | null>(null);
  const [nodeCount, setNodeCount] = useState(100);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);

  // 加载演示数据
  const loadDemoData = useCallback(
    (count: number) => {
      if (!engine) return;

      const data = generateDemoData(count);
      engine.load_data(data.nodes, data.edges);
      engine.fit_to_view(50);
    },
    [engine]
  );

  // 引擎就绪后加载数据
  const handleEngineReady = useCallback(
    (eng: GraphEngineWasm) => {
      setEngine(eng);
      // 延迟加载数据以确保 canvas 已初始化
      setTimeout(() => {
        const data = generateDemoData(nodeCount);
        eng.load_data(data.nodes, data.edges);
        eng.fit_to_view(50);
      }, 100);
    },
    [nodeCount]
  );

  return (
    <main className="flex flex-col h-screen">
      {/* 头部工具栏 */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <h1 className="text-lg font-semibold">Customer Graph</h1>

        <div className="flex items-center gap-4">
          {/* 节点数量控制 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">节点数:</label>
            <input
              type="number"
              value={nodeCount}
              onChange={(e) => setNodeCount(parseInt(e.target.value) || 100)}
              className="w-20 px-2 py-1 bg-gray-800 rounded text-sm"
              min={10}
              max={10000}
            />
            <button
              onClick={() => loadDemoData(nodeCount)}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              disabled={!engine}
            >
              生成
            </button>
          </div>

          {/* 统计信息 */}
          {engine && (
            <div className="text-sm text-gray-400">
              节点: {engine.get_node_count()} | 边: {engine.get_edge_count()}
            </div>
          )}
        </div>
      </header>

      {/* Canvas 容器 */}
      <div className="flex-1 relative bg-gray-950">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: 'none' }}
        />

        <WasmLoader
          canvasRef={canvasRef}
          fallback={(progress) => <LoadingScreen progress={progress} />}
        >
          {(eng) => {
            // 引擎就绪后设置状态
            if (eng !== engine) {
              setTimeout(() => handleEngineReady(eng), 0);
            }

            return (
              <GraphCanvas
                engine={eng}
                className="absolute inset-0"
                onNodeClick={(id) => setSelectedNode(id)}
              />
            );
          }}
        </WasmLoader>
      </div>

      {/* 底部状态栏 */}
      <footer className="flex items-center justify-between px-4 py-1 bg-gray-900 border-t border-gray-800 text-xs text-gray-500">
        <div>
          {selectedNode !== null
            ? `选中节点: ${selectedNode}`
            : '点击节点以选择'}
        </div>
        <div>
          快捷键: R=重置视图 | F=适配视图 | ESC=取消选择
        </div>
      </footer>
    </main>
  );
}
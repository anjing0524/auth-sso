'use client';

import { useState } from 'react';

export interface NodeDetail {
  id: number;
  name: string;
  type: string;
  degree: number;
  x: number;
  y: number;
}

export interface NodeDetailPanelProps {
  /** 节点详情数据 */
  node: NodeDetail | null;
  /** 关闭回调 */
  onClose?: () => void;
  /** 高亮邻居回调 */
  onHighlightNeighbors?: (nodeId: number) => void;
}

/**
 * 节点详情面板组件
 *
 * 显示选中节点的详细信息
 */
export function NodeDetailPanel({
  node,
  onClose,
  onHighlightNeighbors,
}: NodeDetailPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!node) return null;

  return (
    <div
      className={`absolute right-4 top-4 bg-gray-900 border border-gray-700 rounded-lg shadow-xl transition-all duration-200 ${
        isExpanded ? 'w-72' : 'w-12'
      }`}
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        {isExpanded && (
          <h3 className="text-sm font-medium text-gray-200">节点详情</h3>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-gray-400 hover:text-gray-200 rounded"
            title={isExpanded ? '收起' : '展开'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? '' : 'rotate-180'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          {isExpanded && onClose && (
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-200 rounded"
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* 节点 ID */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">节点 ID</label>
            <p className="text-sm font-mono text-gray-300">{node.id}</p>
          </div>

          {/* 节点名称 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">名称</label>
            <p className="text-sm text-gray-300">{node.name}</p>
          </div>

          {/* 节点类型 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">类型</label>
            <span className="inline-block px-2 py-0.5 text-xs bg-blue-900/50 text-blue-300 rounded">
              {node.type}
            </span>
          </div>

          {/* 关联数量 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">关联数量</label>
            <p className="text-sm text-gray-300">{node.degree} 个关联</p>
          </div>

          {/* 位置 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">位置</label>
            <p className="text-sm font-mono text-gray-400">
              ({node.x.toFixed(1)}, {node.y.toFixed(1)})
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="pt-2 border-t border-gray-700">
            <button
              onClick={() => onHighlightNeighbors?.(node.id)}
              className="w-full px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              高亮关联节点
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
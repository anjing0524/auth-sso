'use client';

import { useState, useCallback } from 'react';

export interface SearchBarProps {
  /** 搜索回调 */
  onSearch?: (query: string) => void;
  /** 占位符 */
  placeholder?: string;
}

/**
 * 搜索栏组件
 */
export function SearchBar({
  onSearch,
  placeholder = '搜索节点...',
}: SearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSearch = useCallback(() => {
    onSearch?.(query);
  }, [query, onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSearch();
      }
    },
    [handleSearch]
  );

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 pl-9 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {query && (
        <button
          onClick={() => {
            setQuery('');
            onSearch?.('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300"
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
  );
}

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterPanelProps {
  /** 类型过滤选项 */
  typeOptions?: FilterOption[];
  /** 当前选中的类型 */
  selectedType?: string | null;
  /** 类型变化回调 */
  onTypeChange?: (type: string | null) => void;
  /** 最小关联数 */
  minDegree?: number;
  /** 关联数变化回调 */
  onDegreeChange?: (minDegree: number | null) => void;
  /** 重置过滤回调 */
  onReset?: () => void;
}

/**
 * 过滤面板组件
 */
export function FilterPanel({
  typeOptions = [],
  selectedType,
  onTypeChange,
  minDegree,
  onDegreeChange,
  onReset,
}: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasActiveFilters = selectedType !== null || (minDegree ?? 0) > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
          hasActiveFilters
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
        }`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        <span>过滤</span>
        {hasActiveFilters && (
          <span className="w-2 h-2 bg-white rounded-full" />
        )}
      </button>

      {isExpanded && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-10">
          <div className="p-4 space-y-4">
            {/* 类型过滤 */}
            {typeOptions.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-2">
                  节点类型
                </label>
                <select
                  value={selectedType ?? ''}
                  onChange={(e) =>
                    onTypeChange?.(e.target.value || null)
                  }
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="">全部类型</option>
                  {typeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                      {opt.count !== undefined && ` (${opt.count})`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 关联数过滤 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">
                最小关联数: {minDegree ?? 0}
              </label>
              <input
                type="range"
                min="0"
                max="50"
                value={minDegree ?? 0}
                onChange={(e) =>
                  onDegreeChange?.(parseInt(e.target.value) || null)
                }
                className="w-full h-2 bg-gray-700 rounded appearance-none cursor-pointer"
              />
            </div>

            {/* 重置按钮 */}
            {hasActiveFilters && (
              <button
                onClick={() => {
                  onTypeChange?.(null);
                  onDegreeChange?.(null);
                  onReset?.();
                }}
                className="w-full px-3 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded"
              >
                重置过滤
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
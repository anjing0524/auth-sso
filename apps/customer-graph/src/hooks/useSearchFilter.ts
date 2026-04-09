/**
 * 搜索和过滤状态管理 Hook
 * 用于图数据的搜索和过滤功能
 */
import { useState, useCallback, useMemo, useEffect } from 'react';

/**
 * 节点数据结构
 */
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  properties?: Record<string, unknown>;
}

/**
 * 边数据结构
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

/**
 * 过滤选项
 */
export interface FilterOptions {
  /** 搜索关键词 */
  searchQuery: string;
  /** 选中的节点类型 */
  selectedType: string | null;
  /** 最小关联数 */
  minDegree: number;
}

/**
 * Hook 返回值
 */
export interface UseSearchFilterResult {
  /** 过滤选项 */
  filters: FilterOptions;
  /** 设置搜索关键词 */
  setSearchQuery: (query: string) => void;
  /** 设置选中的节点类型 */
  setSelectedType: (type: string | null) => void;
  /** 设置最小关联数 */
  setMinDegree: (degree: number) => void;
  /** 重置所有过滤条件 */
  resetFilters: () => void;
  /** 过滤后的节点列表 */
  filteredNodes: GraphNode[];
  /** 过滤后的边列表 */
  filteredEdges: GraphEdge[];
  /** 节点类型选项 */
  typeOptions: Array<{ value: string; label: string; count: number }>;
  /** 是否有活跃的过滤条件 */
  hasActiveFilters: boolean;
  /** 是否无结果 */
  isEmpty: boolean;
}

/**
 * 默认过滤选项
 */
const DEFAULT_FILTERS: FilterOptions = {
  searchQuery: '',
  selectedType: null,
  minDegree: 0,
};

/**
 * 搜索和过滤 Hook
 */
export function useSearchFilter(
  nodes: GraphNode[],
  edges: GraphEdge[],
  debounceMs: number = 300
): UseSearchFilterResult {
  const [filters, setFilters] = useState<FilterOptions>(DEFAULT_FILTERS);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(filters.searchQuery);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [filters.searchQuery, debounceMs]);

  // 计算节点关联度
  const nodeDegrees = useMemo(() => {
    const degrees = new Map<string, number>();

    edges.forEach((edge) => {
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
      degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
    });

    return degrees;
  }, [edges]);

  // 节点类型统计
  const typeOptions = useMemo(() => {
    const typeCounts = new Map<string, number>();

    nodes.forEach((node) => {
      typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
    });

    return Array.from(typeCounts.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count);
  }, [nodes]);

  // 过滤节点
  const filteredNodes = useMemo(() => {
    let result = nodes;

    // 搜索过滤
    if (debouncedQuery) {
      const query = debouncedQuery.toLowerCase();
      result = result.filter((node) => {
        const labelMatch = node.label.toLowerCase().includes(query);
        const idMatch = node.id.toLowerCase().includes(query);
        const propsMatch = node.properties
          ? Object.values(node.properties).some(
              (v) =>
                typeof v === 'string' && v.toLowerCase().includes(query)
            )
          : false;

        return labelMatch || idMatch || propsMatch;
      });
    }

    // 类型过滤
    if (filters.selectedType) {
      result = result.filter((node) => node.type === filters.selectedType);
    }

    // 关联数过滤
    if (filters.minDegree > 0) {
      result = result.filter(
        (node) => (nodeDegrees.get(node.id) || 0) >= filters.minDegree
      );
    }

    return result;
  }, [nodes, debouncedQuery, filters.selectedType, filters.minDegree, nodeDegrees]);

  // 过滤边 (只保留两端节点都在过滤结果中的边)
  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(
    () =>
      edges.filter(
        (edge) =>
          filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
      ),
    [edges, filteredNodeIds]
  );

  // 设置函数
  const setSearchQuery = useCallback((query: string) => {
    setFilters((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setSelectedType = useCallback((type: string | null) => {
    setFilters((prev) => ({ ...prev, selectedType: type }));
  }, []);

  const setMinDegree = useCallback((degree: number) => {
    setFilters((prev) => ({ ...prev, minDegree: degree }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  // 计算状态
  const hasActiveFilters =
    filters.searchQuery !== '' ||
    filters.selectedType !== null ||
    filters.minDegree > 0;

  const isEmpty = filteredNodes.length === 0 && nodes.length > 0;

  return {
    filters,
    setSearchQuery,
    setSelectedType,
    setMinDegree,
    resetFilters,
    filteredNodes,
    filteredEdges,
    typeOptions,
    hasActiveFilters,
    isEmpty,
  };
}
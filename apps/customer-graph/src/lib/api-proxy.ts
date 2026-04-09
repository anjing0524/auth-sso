/**
 * 外部 API 代理
 * 用于安全地调用客户关系数据 API
 */

/**
 * API 代理配置
 */
export const apiProxyConfig = {
  baseUrl: (process.env['CUSTOMER_API_URL'] || 'https://api.example.com').trim(),
  apiKey: process.env['CUSTOMER_API_KEY'] || '',

  // 速率限制：每个用户每分钟最大请求数
  rateLimitPerMinute: 10,

  // 响应大小限制 (5MB)
  maxResponseSize: 5 * 1024 * 1024,

  // 请求超时 (30秒)
  requestTimeout: 30000,
};

/**
 * 速率限制状态
 * 使用内存存储（生产环境应使用 Redis）
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * 检查速率限制
 */
export function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = 60000; // 1 分钟窗口

  let record = rateLimitStore.get(userId);

  if (!record || now > record.resetAt) {
    // 创建新的窗口
    record = {
      count: 0,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(userId, record);
  }

  if (record.count >= apiProxyConfig.rateLimitPerMinute) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: record.resetAt,
    };
  }

  record.count++;

  return {
    allowed: true,
    remaining: apiProxyConfig.rateLimitPerMinute - record.count,
    resetAt: record.resetAt,
  };
}

/**
 * 图数据请求参数
 */
export interface GraphDataParams {
  /** 部门 ID 过滤 */
  departmentIds?: string[];
  /** 搜索关键词 */
  search?: string;
  /** 节点类型过滤 */
  nodeTypes?: string[];
  /** 关系类型过滤 */
  edgeTypes?: string[];
  /** 分页偏移 */
  offset?: number;
  /** 分页大小 */
  limit?: number;
}

/**
 * 图数据响应
 */
export interface GraphDataResponse {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    properties: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    properties: Record<string, unknown>;
  }>;
  total: number;
}

/**
 * 调用外部 API 获取图数据
 */
export async function fetchGraphData(params: GraphDataParams): Promise<GraphDataResponse> {
  const url = new URL('/graph/data', apiProxyConfig.baseUrl);

  // 构建查询参数
  if (params.departmentIds && params.departmentIds.length > 0) {
    url.searchParams.set('department_ids', params.departmentIds.join(','));
  }
  if (params.search) {
    url.searchParams.set('search', params.search);
  }
  if (params.nodeTypes && params.nodeTypes.length > 0) {
    url.searchParams.set('node_types', params.nodeTypes.join(','));
  }
  if (params.edgeTypes && params.edgeTypes.length > 0) {
    url.searchParams.set('edge_types', params.edgeTypes.join(','));
  }
  if (params.offset !== undefined) {
    url.searchParams.set('offset', String(params.offset));
  }
  if (params.limit !== undefined) {
    url.searchParams.set('limit', String(params.limit));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), apiProxyConfig.requestTimeout);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiProxyConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    // 检查响应大小
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > apiProxyConfig.maxResponseSize) {
      throw new Error('Response too large');
    }

    const data = await response.json();

    return data as GraphDataResponse;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout');
    }

    throw error;
  }
}

/**
 * 节点详情响应
 */
export interface NodeDetailResponse {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  connections: {
    incoming: number;
    outgoing: number;
  };
}

/**
 * 获取节点详情
 */
export async function fetchNodeDetail(nodeId: string): Promise<NodeDetailResponse> {
  const url = new URL(`/graph/nodes/${nodeId}`, apiProxyConfig.baseUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), apiProxyConfig.requestTimeout);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiProxyConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return data as NodeDetailResponse;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout');
    }

    throw error;
  }
}
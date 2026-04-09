/**
 * 图数据 API
 * 代理外部 API 调用，应用权限和数据范围过滤
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPermission, getDataScopeFilter } from '@/lib/auth-middleware';
import { fetchGraphData, checkRateLimit } from '@/lib/api-proxy';

export const runtime = 'nodejs';

/**
 * GET /api/graph
 * 获取图数据，应用数据范围过滤
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 验证权限
    const check = await checkPermission(request, { permissions: ['customer_graph:view'] });
    if (!check.authorized) {
      return NextResponse.json(
        { error: check.error },
        { status: check.statusCode }
      );
    }

    const userId = check.userId!;

    // 2. 检查速率限制
    const rateLimit = checkRateLimit(userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', resetAt: rateLimit.resetAt },
        { status: 429, headers: { 'X-RateLimit-Reset': String(rateLimit.resetAt) } }
      );
    }

    // 3. 获取数据范围
    const dataScope = await getDataScopeFilter(userId);

    // 4. 解析请求参数
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || undefined;
    const nodeTypes = searchParams.get('node_types')?.split(',').filter(Boolean) || undefined;
    const edgeTypes = searchParams.get('edge_types')?.split(',').filter(Boolean) || undefined;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;

    // 5. 构建过滤参数
    const filterParams = dataScope.type === 'ALL'
      ? {}
      : { departmentIds: dataScope.deptIds };

    // 6. 调用外部 API
    try {
      const graphData = await fetchGraphData({
        ...filterParams,
        search,
        nodeTypes,
        edgeTypes,
        offset,
        limit: limit || 1000, // 默认限制 1000 个节点
      });

      // 7. 返回响应
      return NextResponse.json(graphData, {
        headers: {
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      });
    } catch (error) {
      console.error('[Graph API] External API error:', error);

      if (error instanceof Error) {
        if (error.message === 'Response too large') {
          return NextResponse.json(
            { error: 'Response too large. Please narrow your search.' },
            { status: 413 }
          );
        }
        if (error.message === 'Request timeout') {
          return NextResponse.json(
            { error: 'Request timeout. Please try again.' },
            { status: 504 }
          );
        }
      }

      return NextResponse.json(
        { error: 'Failed to fetch graph data' },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error('[Graph API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
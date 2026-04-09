/**
 * 节点详情 API
 * 获取单个节点的详细信息
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPermission } from '@/lib/auth-middleware';
import { fetchNodeDetail, checkRateLimit } from '@/lib/api-proxy';

export const runtime = 'nodejs';

/**
 * GET /api/graph/nodes/[id]
 * 获取节点详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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
        { status: 429 }
      );
    }

    // 3. 获取节点详情
    try {
      const nodeDetail = await fetchNodeDetail(id);

      // TODO: 验证节点是否在用户的数据范围内
      // 这需要外部 API 支持返回节点的部门归属信息

      return NextResponse.json(nodeDetail);
    } catch (error) {
      console.error('[Node Detail API] External API error:', error);

      if (error instanceof Error && error.message === 'Request timeout') {
        return NextResponse.json(
          { error: 'Request timeout' },
          { status: 504 }
        );
      }

      return NextResponse.json(
        { error: 'Node not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('[Node Detail API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
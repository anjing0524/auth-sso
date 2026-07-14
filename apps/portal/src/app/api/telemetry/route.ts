/**
 * 遥测端点 (POST /api/telemetry)
 *
 * 最小化客户端事件追踪：页面浏览、功能使用、错误。
 * 当前写入 stdout（生产环境可替换为 ClickHouse/BigQuery/PostgreSQL）。
 * 受 withPermission 保护（system:view_dashboard），防止未认证的遥测洪水。
 *
 * @route POST /api/telemetry
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';

const TelemetrySchema = z.object({
  type: z.string().min(1).max(64),
  path: z.string().max(256),
  userId: z.string().max(64).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  // 先解析 body（在鉴权外），避免 withPermission 回调内嵌套 try-catch
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: COMMON_ERRORS.INVALID_REQUEST, message: '请求体格式错误' },
      { status: 400 },
    );
  }

  const parsed = TelemetrySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message },
      { status: 400 },
    );
  }

  // 请求体大小限制：遥测事件不应超过 8KB
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 8192) {
    return NextResponse.json(
      { success: false, error: COMMON_ERRORS.PAYLOAD_TOO_LARGE, message: '请求体过大' },
      { status: 413 },
    );
  }

  return withPermission({ permissions: ['system:view_dashboard'] }, async () => {
    const { type, path, userId, meta } = parsed.data;
    const event = {
      ts: new Date().toISOString(),
      type,
      path,
      userId: userId || 'anonymous',
      meta: meta || {},
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '',
      ua: request.headers.get('user-agent') || '',
    };

    // 写入 stdout → 由日志采集器（Vector/Fluentd）转发到 SIEM/数据仓库
    console.log(JSON.stringify({ '@telemetry': event }));

    return NextResponse.json({ success: true });
  });
}

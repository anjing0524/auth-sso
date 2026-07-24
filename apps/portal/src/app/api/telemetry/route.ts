/**
 * 遥测端点 (POST /api/telemetry)
 *
 * 最小化客户端事件追踪：页面浏览、功能使用、错误。
 * 当前写入 stdout（生产环境可替换为 ClickHouse/BigQuery/PostgreSQL）。
 * 受 withPermission 保护（system:view_dashboard），防止未认证的遥测洪水。
 *
 * @route POST /api/telemetry
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS, SYSTEM_PERMISSIONS } from '@auth-sso/contracts';

const TelemetrySchema = z.object({
  type: z.string().min(1).max(64),
  path: z.string().max(256),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  return withPermission({ permissions: [SYSTEM_PERMISSIONS.VIEW_DASHBOARD] }, async (userId) => {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 8192) {
      return NextResponse.json(
        { error: COMMON_ERRORS.PAYLOAD_TOO_LARGE, message: '请求体过大' },
        { status: 413 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: COMMON_ERRORS.INVALID_REQUEST, message: '请求体格式错误' },
        { status: 400 },
      );
    }

    const parsed = TelemetrySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message },
        { status: 400 },
      );
    }

    const { type, path, meta } = parsed.data;
    const event = {
      ts: new Date().toISOString(),
      type,
      path,
      userId,
      meta: meta || {},
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '',
      ua: request.headers.get('user-agent') || '',
    };

    console.log(JSON.stringify({ '@telemetry': event }));

    return NextResponse.json({ accepted: true });
  });
}

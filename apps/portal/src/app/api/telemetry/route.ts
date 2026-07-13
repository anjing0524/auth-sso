/**
 * 遥测端点 (POST /api/telemetry)
 *
 * 最小化客户端事件追踪：页面浏览、功能使用、错误。
 * 当前写入 stdout（生产环境可替换为 ClickHouse/BigQuery/PostgreSQL）。
 *
 * @route POST /api/telemetry
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const TelemetrySchema = z.object({
  type: z.string().min(1).max(64),
  path: z.string().max(256),
  userId: z.string().max(64).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // 请求体大小限制：遥测事件不应超过 8KB
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 8192) {
      return NextResponse.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }

    const rawBody = await request.json();
    const parsed = TelemetrySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message },
        { status: 400 },
      );
    }

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

    // 生产就绪：写入 stdout → 由日志采集器（Vector/Fluentd）转发到 SIEM/数据仓库
    console.log(JSON.stringify({ '@telemetry': event }));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }
}

/**
 * 遥测端点 (POST /api/telemetry)
 *
 * 最小化客户端事件追踪：页面浏览、功能使用、错误。
 * 当前写入 stdout（生产环境可替换为 ClickHouse/BigQuery/PostgreSQL）。
 *
 * @route POST /api/telemetry
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const event = {
      ts: new Date().toISOString(),
      type: body.type || 'unknown',
      path: body.path || '',
      userId: body.userId || 'anonymous',
      meta: body.meta || {},
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

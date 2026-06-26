/**
 * 审计日志 CSV 导出 API (GET /api/audit/export)
 *
 * SIEM 集成：支持 Splunk/Datadog/Sentinel 等系统通过 webhook 或定时拉取导入日志。
 * 返回 RFC 4180 CSV 格式，BOM 头兼容 Excel 中文打开。
 *
 * @route GET /api/audit/export?type=login|operation
 */
import { NextRequest, NextResponse } from 'next/server';
import { getLoginLogs, getAuditLogs } from '@/app/audit/data';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'login';

  try {
    let csv: string;
    const pagination = { page: 1, pageSize: 10000 };

    if (type === 'login') {
      const logs = await getLoginLogs(pagination);
      csv = '﻿' + [
        '时间,用户,事件类型,IP地址,User-Agent,失败原因',
        ...logs.data.map((l: Record<string, unknown>) =>
          [l.createdAt, l.username, l.eventType, l.ip, (l.userAgent as string || '').replace(/,/g, ' '), l.failReason || ''].join(',')
        ),
      ].join('\n');
    } else {
      const logs = await getAuditLogs(pagination);
      csv = '﻿' + [
        '时间,操作人,操作类型,目标资源,详情,IP地址',
        ...logs.data.map((l: Record<string, unknown>) =>
          [l.createdAt, l.operator || l.username, l.operation, l.resource, (l.detail as string || '').replace(/,/g, ' '), l.ip || ''].join(',')
        ),
      ].join('\n');
    }

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error('[Audit Export] 导出失败:', err);
    return NextResponse.json({ success: false, error: 'EXPORT_FAILED' }, { status: 500 });
  }
}

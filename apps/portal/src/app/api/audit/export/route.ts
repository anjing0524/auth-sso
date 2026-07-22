/**
 * 审计日志 CSV 导出 API (GET /api/audit/export)
 *
 * SIEM 集成：支持 Splunk/Datadog/Sentinel 等系统通过 webhook 或定时拉取导入日志。
 * 返回 RFC 4180 CSV 格式，BOM 头兼容 Excel 中文打开。
 *
 * @route GET /api/audit/export?type=login|operation
 * @permission audit:export
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getLoginLogs, getAuditLogs } from '@/app/audit/data';
import { withPermission } from '@/lib/auth';
import { MAX_PAGE_SIZE } from '@auth-sso/contracts';

export async function GET(request: NextRequest) {
  return withPermission(
    { permissions: ['audit:export'] },
    async () => {
      const { searchParams } = new URL(request.url);
      const type = searchParams.get('type') || 'login';

      let csv: string;
      const pagination = { page: 1, pageSize: MAX_PAGE_SIZE };

      // 将单元格值转为 RFC 4180 安全的 CSV 字段（含公式注入防护）
      const csvEscape = (v: unknown): string => {
        const s = String(v ?? '');
        // CSV 公式注入防护：以 = + - @ 开头的字段加 tab 前缀，阻止 Excel 执行
        const escaped = /^[=+\-@\t\r]/.test(s) ? '\t' + s : s;
        // 含逗号、双引号、换行符的字段用双引号包裹
        if (/[",\n\r]/.test(escaped)) {
          return '"' + escaped.replace(/"/g, '""') + '"';
        }
        return escaped;
      };

      if (type === 'login') {
        const logs = await getLoginLogs(pagination);
        csv = '\uFEFF' + [
          '时间,用户,事件类型,IP地址,User-Agent,失败原因',
          ...logs.data.map((l: Record<string, unknown>) =>
            [l.createdAt, l.username, l.eventType, l.ip, l.userAgent, l.failReason].map(csvEscape).join(',')
          ),
        ].join('\n');
      } else {
        const logs = await getAuditLogs(pagination);
        csv = '\uFEFF' + [
          '时间,操作人,操作类型,目标资源,详情,IP地址',
          ...logs.data.map((l: Record<string, unknown>) =>
            [l.createdAt, l.operator || l.username, l.operation, l.resource, l.detail, l.ip].map(csvEscape).join(',')
          ),
        ].join('\n');
      }

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    },
  );
}

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
import { isIsoDate } from '@/lib/iso-date';
import {
  AUDIT_PERMISSIONS,
  COMMON_ERRORS,
  MAX_PAGE_SIZE,
  LOGIN_EVENT_VALUES,
  AUDIT_OPERATION_VALUES,
  type LoginEventType,
  type AuditOperation,
} from '@auth-sso/contracts';
import { withPermission } from '@/lib/auth';
import { restError } from '@/lib/response';
import { getAccessLogs, getAuditLogs, getLoginLogs } from '@/app/audit/data';
import { isUuid } from '@/lib/uuid';

/** 导出上限：防止一次拉爆内存（10 万行 ≈ 权限表 2000 页也远超实际）。 */
const EXPORT_MAX_ROWS = 100_000;

/**
 * 将单元格值转为 RFC 4180 安全的 CSV 字段（含公式注入防护）。
 *
 * H-28：`String()` 会把 Date 变成 `Fri Oct 23 2026 ...`（非 ISO）、把 jsonb 对象变成
 * `[object Object]`（2026-10-23 实测 5205/5238 行「详情」列损坏）。按类型显式序列化。
 */
function csvEscape(v: unknown): string {
  const serialized = v instanceof Date
    ? v.toISOString()
    : (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
  // CSV 公式注入防护：以 = + - @ 开头的字段加 tab 前缀，阻止 Excel 执行
  const escaped = /^[=+\-@\t\r]/.test(serialized) ? '\t' + serialized : serialized;
  // 含逗号、双引号、换行符的字段用双引号包裹
  if (/[",\n\r]/.test(escaped)) {
    return '"' + escaped.replace(/"/g, '""') + '"';
  }
  return escaped;
}

/** 单页读取结果（数据行 + 是否还有下一页） */
interface CsvPage {
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly hasMore: boolean;
}

/**
 * 把「分页读模型」包装成 CSV 流（H-30）。
 *
 * 此前实现把全部行收进数组再 join：5238 行尚可（138ms），但导出上限 10 万行时
 * 会同时驻留全量对象 + 全量字符串（两份），且 TTFB 等待全部读完。
 * 现在首字节在读完第一页后立即发出，客户端边下边收；内存占用与单页大小同阶。
 *
 * 注意：这里刻意**不**做成纯 `ReadableStream.pull` 拉模式——读模型本身是异步分页，
 * 用 async generator + `ReadableStream` 的默认背压（pull 时消费一项）即可。
 */
function createCsvStream(
  header: string,
  loadPage: (page: number) => Promise<CsvPage>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const generator = async function* (): AsyncGenerator<string> {
    yield '\uFEFF' + header + '\n';
    let pageNo = 1;
    let emitted = 0;
    for (;;) {
      const page = await loadPage(pageNo);
      for (const row of page.rows) {
        if (emitted >= EXPORT_MAX_ROWS) break;
        yield row.map(csvEscape).join(',') + '\n';
        emitted += 1;
      }
      if (!page.hasMore || page.rows.length === 0 || emitted >= EXPORT_MAX_ROWS) break;
      pageNo += 1;
    }
  };

  const iterator = generator();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}


interface ExportFilters {
  eventType?: LoginEventType;
  operation?: AuditOperation;
  startDate?: string;
  endDate?: string;
  userId?: string;
  accessStatus?: 'SUCCESS' | 'FAILURE';
  resourceType?: string;
  keyword?: string;
}

type ParsedExport = { ok: true; type: string; filters: ExportFilters } | { ok: false; response: NextResponse };

function readEnumParam<T extends string>(raw: string | null, values: readonly T[]): T | undefined {
  return values.includes(raw as T) ? (raw as T) : undefined;
}

function readExportFilters(searchParams: URLSearchParams): ExportFilters {
  const statusParam = searchParams.get('status');
  return {
    eventType: readEnumParam(searchParams.get('eventType'), LOGIN_EVENT_VALUES),
    operation: readEnumParam(searchParams.get('operation'), AUDIT_OPERATION_VALUES),
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
    userId: searchParams.get('userId') || undefined,
    accessStatus: statusParam === 'SUCCESS' || statusParam === 'FAILURE' ? statusParam : undefined,
    resourceType: searchParams.get('resourceType')?.trim().slice(0, 50) || undefined,
    keyword: searchParams.get('keyword')?.trim() || undefined,
  };
}

function validateExportFilters(searchParams: URLSearchParams, filters: ExportFilters): NextResponse | null {
  const keywordParam = searchParams.get('keyword');
  if (keywordParam && keywordParam.length > 100) {
    return restError(COMMON_ERRORS.VALIDATION_ERROR, 'keyword 最长 100 字符', 400);
  }
  if ((filters.startDate && !isIsoDate(filters.startDate)) || (filters.endDate && !isIsoDate(filters.endDate))) {
    return restError(COMMON_ERRORS.VALIDATION_ERROR, 'startDate/endDate 必须是 YYYY-MM-DD', 400);
  }
  if (filters.userId && !isUuid(filters.userId)) {
    return restError(COMMON_ERRORS.VALIDATION_ERROR, 'userId 必须是 UUID', 400);
  }
  return null;
}

/** 解析并校验导出筛选；错误直接返回 400 信封。 */
function parseExportQuery(searchParams: URLSearchParams): ParsedExport {
  const type = searchParams.get('type') || 'login';
  const filters = readExportFilters(searchParams);
  const validationError = validateExportFilters(searchParams, filters);
  return validationError
    ? { ok: false, response: validationError }
    : { ok: true, type, filters };
}

function commonFilterParams(filters: ExportFilters) {
  return {
    ...(filters.startDate ? { startDate: filters.startDate } : {}),
    ...(filters.endDate ? { endDate: filters.endDate } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.keyword ? { keyword: filters.keyword } : {}),
  };
}

function loginExportStream(filters: ExportFilters): ReadableStream<Uint8Array> {
  return createCsvStream('时间,用户,事件类型,IP地址,User-Agent,失败原因', async (pageNo) => {
    const res = await getLoginLogs({
      page: pageNo,
      pageSize: MAX_PAGE_SIZE,
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...commonFilterParams(filters),
    });
    return {
      rows: res.data.map((l) => [l.createdAt, l.username, l.eventType, l.ip, l.userAgent, l.failReason]),
      hasMore: pageNo < res.pagination.totalPages,
    };
  });
}

function operationExportStream(filters: ExportFilters): ReadableStream<Uint8Array> {
  return createCsvStream('时间,操作人,操作类型,目标资源,详情,IP地址', async (pageNo) => {
    const res = await getAuditLogs({
      page: pageNo,
      pageSize: MAX_PAGE_SIZE,
      ...(filters.operation ? { operation: filters.operation } : {}),
      ...commonFilterParams(filters),
    });
    return {
      rows: res.data.map((l) => [l.createdAt, l.username, l.operation, l.url, l.params, l.ip]),
      hasMore: pageNo < res.pagination.totalPages,
    };
  });
}

function accessExportStream(filters: ExportFilters): ReadableStream<Uint8Array> {
  return createCsvStream('时间,用户,方法,路径,资源类型,资源ID,状态码,耗时(ms),IP地址,User-Agent', async (pageNo) => {
    const res = await getAccessLogs({
      page: pageNo,
      pageSize: MAX_PAGE_SIZE,
      ...commonFilterParams(filters),
      ...(filters.accessStatus ? { status: filters.accessStatus } : {}),
      ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
    });
    return {
      rows: res.data.map((l) => [
        l.createdAt, l.username, l.method, l.path, l.resourceType, l.resourceId,
        l.status, l.duration, l.ip, l.userAgent,
      ]),
      hasMore: pageNo < res.pagination.totalPages,
    };
  });
}

function buildExportStream(type: string, filters: ExportFilters): ReadableStream<Uint8Array> {
  if (type === 'login') return loginExportStream(filters);
  if (type === 'operation') return operationExportStream(filters);
  return accessExportStream(filters);
}

export async function GET(request: NextRequest) {
  return withPermission(
    { permissions: [AUDIT_PERMISSIONS.EXPORT] },
    async () => {
      const parsed = parseExportQuery(new URL(request.url).searchParams);
      if (!parsed.ok) return parsed.response;
      const { type, filters } = parsed;
      return new NextResponse(buildExportStream(type, filters), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    },
  );
}

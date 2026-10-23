/**
 * 共享 DataTable 组件 — 薄抽象，补充 shadcn/ui Table 缺失的加载态/空状态模式
 *
 * 从 4 个 dashboard 模块的表格中提取公共模式：
 * - Card 包裹 + Table 结构
 * - 加载态 Skeleton 行（可配置列数）
 * - 空状态提示
 *
 * 各模块自行管理：列定义、数据获取、搜索/筛选、行操作。
 */
'use client';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export interface DataTableProps<T> {
  /** 表格列头定义 */
  columns: { key: string; header: string; className?: string }[];
  /** 数据行 */
  data: T[];
  /** 加载中（显示骨架屏） */
  loading?: boolean;
  /** 骨架屏行数 */
  skeletonRows?: number;
  /** 空状态文本（emptyState 未传入时的 fallback） */
  emptyText?: string;
  /** 空状态组件（优先级高于 emptyText） */
  emptyState?: React.ReactNode;
  /** 渲染单行 */
  renderRow: (item: T) => React.ReactNode;
  /** Card header（搜索栏、统计等），可选 */
  cardHeader?: React.ReactNode;
  /**
   * 表格滚动区高度上限（默认按无页签列表；带页签页面传更小值）。
   *
   * 2026-10-23 UI 重做：**卡片不再 flex-1 撑满**——角色等小数据集（1–3 行）
   * 被撑成整屏空白卡片是"主体和留白比例失衡"的根源；现在卡片贴合内容，
   * 行数多时由这里的 max-height 让表格内部滚动（表头 sticky 依然生效）。
   */
  maxHeightClass?: string;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  skeletonRows = 3,
  emptyText = '暂无数据',
  emptyState,
  renderRow,
  cardHeader,
  maxHeightClass = 'max-h-[calc(100svh-13rem)]',
}: DataTableProps<T>) {
  return (
    <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
      {cardHeader}
      <CardContent className="p-0">
        {/* 横向滚动提示：宽表在卡片内横向滚动（U-G05）。
            md:hidden 会在 ≥768px 隐藏，但 1024 宽度下宽表仍溢出（实测 clients 720/967），
            因此用 lg:hidden：平板/窄桌面也能看到“可横向滚动”的可发现性提示。 */}
        <p className="border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground lg:hidden">
          左右滑动查看完整表格
        </p>
        {/* 窄屏下宽表在卡片内横向滚动：根因修复——此前表格没有滚动容器，
            会把 flex 父级撑宽（实测 390px 视口下 document.scrollWidth=557）。 */}
        {/* 唯一滚动容器：横向 + 纵向都由这里承担；Table 内层不再自建 overflow（否则 sticky 表头失效）。 */}
        <div className={`${maxHeightClass} scrollbar-slim w-full overflow-auto`}>
        <Table containerClassName="overflow-visible">
          <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-5 w-full rounded" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              emptyState ? (
                <TableRow>
                  <TableCell colSpan={Math.max(1, columns.length)} className="p-0">
                    {emptyState}
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={Math.max(1, columns.length)}
                    className="h-64 text-center text-muted-foreground"
                  >
                    {emptyText}
                  </TableCell>
                </TableRow>
              )
            ) : (
              data.map((item) => renderRow(item))
            )}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}

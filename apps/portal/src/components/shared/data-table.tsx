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
  /** 表格滚动区高度上限（默认按无页签列表；带页签页面传更小值） */
  maxHeightClass?: string;
  /** 撑满父容器剩余高度（列表页主内容区），表格内部滚动、分页固定在卡片下方 */
  fill?: boolean;
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
  maxHeightClass = 'max-h-[calc(100vh-21rem)]',
  fill = false,
}: DataTableProps<T>) {
  return (
    <Card className={`overflow-hidden rounded-xl border-none shadow-sm ring-1 ring-border/50${fill ? ' flex min-h-0 flex-1 flex-col' : ''}`}>
      {cardHeader}
      <CardContent className={fill ? 'flex min-h-0 flex-1 flex-col p-0' : 'p-0'}>
        {/* 窄屏提示：宽表在卡片内横向滚动，但此前没有任何可发现性提示 */}
        <p className="border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground md:hidden">
          左右滑动查看完整表格
        </p>
        {/* 窄屏下宽表在卡片内横向滚动：根因修复——此前表格没有滚动容器，
            会把 flex 父级撑宽（实测 390px 视口下 document.scrollWidth=557）。 */}
        <div className={fill ? 'min-h-0 w-full flex-1 overflow-auto' : `${maxHeightClass} w-full overflow-auto`}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/50">
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

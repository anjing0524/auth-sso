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
}: DataTableProps<T>) {
  return (
    <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-xl">
      {cardHeader}
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-slate-50/30">
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
                  <TableCell colSpan={columns.length} className="p-0">
                    {emptyState}
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
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
      </CardContent>
    </Card>
  );
}

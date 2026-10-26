'use client';

/**
 * 用户管理列表筛选（URL 同步 + 防抖）
 *
 * 2026-10-20 返工：搜索框/筛选器此前是本页自写的一套（w-96、自绘清空按钮、bg-card、
 * focus ring 覆写），与其它列表页不一致。现在统一使用 `SearchInput` + `Select`，
 * 由 `TableToolbar` 提供容器；本组件只负责 URL 同步与防抖。
 */
import { useState, useEffect, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/shared/search-input';

interface UserFiltersProps {
  initialKeyword?: string;
  initialStatus?: string;
  initialDeptId?: string;
  /** ALL | NONE：是否只看未分配角色的用户 */
  initialNoRole?: string;
  departments?: Array<{ id: string; name: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  ALL: '全部状态',
  ACTIVE: '正常',
  DISABLED: '已禁用',
  LOCKED: '已锁定',
};

export default function UserFilters({ initialKeyword = '', initialStatus = 'ALL', initialDeptId = 'ALL', initialNoRole = 'ALL', departments = [] }: UserFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [keyword, setKeyword] = useState(initialKeyword);

  const applyFilter = (name: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'ALL') params.set(name, value);
    else params.delete(name);
    params.set('page', '1');
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  // keyword 防抖后同步到 URL（400ms）
  useEffect(() => {
    const currentKeyword = searchParams.get('keyword') || '';
    if (keyword === currentKeyword) return;
    const timer = setTimeout(() => applyFilter('keyword', keyword), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 keyword 变化时防抖；applyFilter 依赖当前 searchParams，避免每次键入重建定时器
  }, [keyword]);

  return (
    <>
      <SearchInput
        className="col-span-2 md:w-56"
        placeholder="搜索用户名、邮箱或姓名..."
        value={keyword}
        onChange={setKeyword}
      />
      <Select value={initialStatus} onValueChange={(value) => applyFilter('status', value)} disabled={isPending}>
        <SelectTrigger aria-label="过滤状态" className="w-full md:w-32">
          <SelectValue>{STATUS_LABELS[initialStatus] ?? '全部状态'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">全部状态</SelectItem>
          <SelectItem value="ACTIVE">正常</SelectItem>
          <SelectItem value="DISABLED">已禁用</SelectItem>
          <SelectItem value="LOCKED">已锁定</SelectItem>
        </SelectContent>
      </Select>
      <Select value={initialNoRole} onValueChange={(value) => applyFilter('noRole', value === 'NONE' ? '1' : '')} disabled={isPending}>
        <SelectTrigger aria-label="过滤角色分配" className="w-full md:w-32">
          <SelectValue>{initialNoRole === 'NONE' ? '未分配角色' : '全部角色'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">全部角色</SelectItem>
          <SelectItem value="NONE">未分配角色</SelectItem>
        </SelectContent>
      </Select>
      <Select value={initialDeptId} onValueChange={(value) => applyFilter('deptId', value)} disabled={isPending}>
        <SelectTrigger aria-label="过滤部门" className="w-full md:w-32">
          <SelectValue>{departments.find((d) => d.id === initialDeptId)?.name ?? '全部部门'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">全部部门</SelectItem>
          {departments.map((d) => (
            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

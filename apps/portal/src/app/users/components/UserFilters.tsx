'use client';

/**
 * 用户管理列表筛选与搜索组件
 * 采用 URL 查询参数同步过滤状态，天然支持状态分享与浏览器后退
 */

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';

/**
 * 筛选器属性定义
 */
interface UserFiltersProps {
  /** 初始关键字 */
  initialKeyword?: string;
  /** 初始状态过滤 */
  initialStatus?: string;
}

export default function UserFilters({
  initialKeyword = '',
  initialStatus = 'ALL'
}: UserFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // 本地 keyword 状态用于快速响应用户输入输入，防抖后同步至 URL
  const [keyword, setKeyword] = useState(initialKeyword);

  // 当外部传入的初始关键字变化时，同步本地状态
  useEffect(() => {
    setKeyword(initialKeyword);
  }, [initialKeyword]);

  /**
   * 辅助方法：生成更新 query 参数后的 URL
   */
  const createQueryString = (name: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'ALL') {
      params.set(name, value);
    } else {
      params.delete(name);
    }
    // 过滤条件改变时，重置分页到第一页
    params.set('page', '1');
    return params.toString();
  };

  /**
   * 将过滤状态应用到 URL 中以驱动页面重新渲染
   */
  const applyFilter = (name: string, value: string) => {
    const queryString = createQueryString(name, value);
    startTransition(() => {
      router.push(`${pathname}?${queryString}`);
    });
  };

  // 针对 keyword 的防抖处理
  useEffect(() => {
    // 如果值没变，不触发路由切换
    const currentKeyword = searchParams.get('keyword') || '';
    if (keyword === currentKeyword) return;

    const timer = setTimeout(() => {
      applyFilter('keyword', keyword);
    }, 400); // 400ms 去抖

    return () => clearTimeout(timer);
  }, [keyword]);

  return (
    <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
      {/* 搜索输入框 */}
      <div className="relative w-full md:w-96">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
        <Input
          placeholder="搜索用户名、邮箱或姓名..."
          className="pl-10 h-11 rounded-xl bg-white border-slate-200 focus:ring-2 focus:ring-primary/10 transition-all"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {keyword && (
          <button 
            onClick={() => {
              setKeyword('');
              applyFilter('keyword', '');
            }} 
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 状态下拉筛选器 */}
      <div className="flex items-center gap-3 w-full md:w-auto">
        <Select 
          value={initialStatus} 
          onValueChange={(value) => applyFilter('status', value)}
          disabled={isPending}
        >
          <SelectTrigger className="w-full md:w-[150px] h-11 rounded-xl shadow-sm border-slate-200 bg-white">
            <SelectValue placeholder="过滤状态" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="ALL">全部状态</SelectItem>
            <SelectItem value="ACTIVE">正常</SelectItem>
            <SelectItem value="DISABLED">已禁用</SelectItem>
            <SelectItem value="LOCKED">已锁定</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

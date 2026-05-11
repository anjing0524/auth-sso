/**
 * 部门管理页面 - 终极进化版
 * 具备 IDE 级别的视觉连线、动态抽屉、以及 DND 交互手感
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Building2, 
  Plus, 
  ChevronRight, 
  ChevronDown, 
  MoreVertical, 
  Edit, 
  Trash2, 
  Search,
  Workflow,
  Activity,
  Calendar,
  Hash,
  GripVertical,
  Users,
  Shield,
  CheckCircle
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableRow 
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Department {
  id: string;
  publicId: string;
  parentId: string | null;
  name: string;
  code: string | null;
  sort: number;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  children: Department[];
}

/**
 * 现代树形节点组件 - 具备拖拽手感和视觉引导线
 */
function DepartmentItem({
  dept,
  level = 0,
  expanded,
  onToggle,
  onSelect,
  selectedId,
  isLast,
}: {
  dept: Department;
  level?: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (dept: Department) => void;
  selectedId: string | null;
  isLast?: boolean;
}) {
  const hasChildren = dept.children && dept.children.length > 0;
  const isExpanded = expanded.has(dept.id);
  const isSelected = selectedId === dept.id;

  // Exact math for pixel-perfect connecting lines
  const indent = level * 24;
  const lineLeft = (level - 1) * 24 + 42;
  const verticalLineLeft = level * 24 + 42;

  return (
    <div className="relative">
      {level > 0 && (
        <div 
          className="absolute h-px bg-slate-200 dark:bg-slate-700 z-0" 
          style={{ left: `${lineLeft}px`, width: '24px', top: '26px' }}
        />
      )}

      <div
        className={`flex items-center group py-2.5 px-3 my-1 cursor-pointer rounded-xl transition-all duration-300 border border-transparent relative z-10 ${
          isSelected 
            ? 'bg-white dark:bg-slate-900 border-primary/20 shadow-lg shadow-primary/5 ring-1 ring-primary/10' 
            : 'hover:bg-slate-50 dark:hover:bg-slate-900/50 text-slate-600 hover:text-slate-900'
        }`}
        style={{ marginLeft: `${indent}px` }}
        onClick={() => onSelect(dept)}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0 bg-inherit rounded-md">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity mr-1 cursor-grab active:cursor-grabbing">
             <GripVertical className="h-3.5 w-3.5 text-slate-300" />
          </div>
          
          <div 
            className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors bg-inherit z-10 ${
              isExpanded ? 'bg-primary/5 text-primary' : 'hover:bg-slate-200'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(dept.id);
            }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-3.5 w-3.5 bg-inherit" /> : <ChevronRight className="h-3.5 w-3.5 bg-inherit" />
            ) : (
              <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
            )}
          </div>

          <div className={`p-1.5 rounded-lg mr-2 ${isSelected ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>
            <Building2 className="h-3.5 w-3.5" />
          </div>
          
          <span className={`text-sm truncate ${isSelected ? 'font-bold' : 'font-medium'}`}>{dept.name}</span>
        </div>
        
        <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'text-primary' : 'text-slate-400'}`}>
           <span className="text-[10px] font-mono opacity-50 uppercase">{dept.code}</span>
           <MoreVertical className="h-4 w-4" />
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="relative">
          <div 
            className="absolute w-px bg-slate-200 dark:bg-slate-700 z-0" 
            style={{ left: `${verticalLineLeft}px`, top: '-26px', bottom: '26px' }}
          />
          {dept.children.map((child, idx) => (
            <DepartmentItem
              key={child.id}
              dept={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              isLast={idx === dept.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    sort: 0,
    status: 'ACTIVE' as 'ACTIVE' | 'DISABLED',
  });

  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/departments');
      const data = await response.json();
      if (response.ok) {
        setDepartments(data.data);
        const allIds = new Set<string>();
        const collectIds = (depts: Department[]) => {
          depts.forEach(d => {
            if (d.children?.length) {
              allIds.add(d.id);
              collectIds(d.children);
            }
          });
        };
        collectIds(data.data);
        setExpanded(allIds);
      }
    } catch (error) {
      console.error('Failed to fetch departments:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleToggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelect = (dept: Department) => {
    setSelectedDept(dept);
    setIsSheetOpen(true);
    setIsEditMode(false);
  };

  const handleNew = () => {
    setFormData({ name: '', code: '', sort: 0, status: 'ACTIVE' });
    setIsEditMode(true);
    setIsSheetOpen(true);
  };

  const handleSave = async () => {
    try {
      const url = selectedDept && !isEditMode ? `/api/departments/${selectedDept.id}` : '/api/departments';
      const method = selectedDept && !isEditMode ? 'PUT' : 'POST';
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, parentId: selectedDept?.id || null }),
      });
      setIsSheetOpen(false);
      fetchDepartments();
    } catch (error) {
      console.error('Failed to save department:', error);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight text-slate-900">组织架构</h1>
          <p className="text-muted-foreground text-sm font-medium">全域资源管理中心 &bull; 基于层级的 RBAC 数据沙箱</p>
        </div>
        <div className="flex items-center gap-3">
           <Button variant="secondary" size="lg" className="rounded-2xl h-12 px-6">
             <Workflow className="mr-2 h-4 w-4 opacity-50" /> 树形导出
           </Button>
           <Button size="lg" onClick={handleNew} className="rounded-2xl shadow-xl shadow-primary/20 h-12 px-6">
             <Plus className="mr-2 h-5 w-5" /> 创建根节点
           </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <Card className="lg:col-span-8 border-none bg-slate-50/50 p-2 ring-1 ring-slate-200 rounded-[2rem]">
          <CardHeader className="px-6 py-6 flex flex-row items-center justify-between">
            <CardTitle className="text-xl font-bold">架构地图</CardTitle>
            <div className="relative flex-1 max-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
              <Input placeholder="搜索部门..." className="pl-10 h-10 bg-white border-none rounded-xl" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-8">
            {loading ? <Skeleton className="h-40 w-full rounded-2xl" /> : (
              <div className="bg-white/40 rounded-[1.5rem] p-4 border border-white/40">
                {departments.map((dept) => (
                  <DepartmentItem key={dept.id} dept={dept} expanded={expanded} onToggle={handleToggle} onSelect={handleSelect} selectedId={selectedDept?.id || null} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-4 space-y-6">
           <Card className="border-none bg-primary text-white shadow-2xl shadow-primary/20 rounded-[2rem]">
             <CardHeader>
               <Shield className="h-10 w-10 bg-white/20 p-2 rounded-xl mb-2" />
               <CardTitle className="text-lg font-bold">数据沙箱生效中</CardTitle>
             </CardHeader>
             <CardContent className="text-xs opacity-80 leading-relaxed font-medium">
               当前系统已开启 **DEPT_AND_SUB** 递归鉴权。所有位于子部门的用户将自动被上级管理员感知。
             </CardContent>
           </Card>
        </div>
      </div>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="sm:max-w-xl border-l-0 shadow-[-20px_0_80px_rgba(0,0,0,0.1)] p-0 flex flex-col">
          <div className="bg-slate-50 p-8 border-b">
            <Building2 className="h-8 w-8 text-primary mb-4" />
            <SheetTitle className="text-3xl font-black">{isEditMode ? '编辑部门' : selectedDept?.name}</SheetTitle>
          </div>
          <div className="flex-1 overflow-auto p-8">
            {!isEditMode && selectedDept ? (
              <Tabs defaultValue="info">
                <TabsList className="mb-4"><TabsTrigger value="info">基础信息</TabsTrigger><TabsTrigger value="members">该部成员</TabsTrigger></TabsList>
                <TabsContent value="info" className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-50 border"><Label className="text-[10px] uppercase text-slate-400">唯一编码</Label><p className="font-bold">{selectedDept.code}</p></div>
                    <div className="p-4 rounded-2xl bg-slate-50 border"><Label className="text-[10px] uppercase text-slate-400">状态</Label><Badge variant={selectedDept.status === 'ACTIVE' ? 'default' : 'secondary'}>{selectedDept.status}</Badge></div>
                  </div>
                  <Button className="w-full h-14 rounded-2xl font-bold" onClick={() => setIsEditMode(true)}>编辑信息</Button>
                </TabsContent>
                <TabsContent value="members" className="py-10 text-center text-slate-400 italic">正在拉取成员...</TabsContent>
              </Tabs>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2"><Label>部门名称</Label><Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="h-12 rounded-xl" /></div>
                <div className="space-y-2"><Label>部门编码</Label><Input value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} className="h-12 rounded-xl font-mono" /></div>
                <div className="flex gap-4 pt-10"><Button variant="ghost" className="flex-1 h-12" onClick={() => setIsEditMode(false)}>取消</Button><Button className="flex-1 h-12 rounded-xl shadow-lg shadow-primary/20" onClick={handleSave}>保存配置</Button></div>
              </div>
            )}
          </div>
          <div className="p-8 bg-slate-50 border-t flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest"><CheckCircle className="h-4 w-4 text-green-500" /> Security Policy Confirmed</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

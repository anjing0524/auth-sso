'use client';

/**
 * 部门树交互组件 — 展开/折叠、搜索、增删改
 * 写操作通过 Server Actions 直调，不调 REST API
 */
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Building2, Plus, ChevronRight, ChevronDown, Edit, Trash2, Users, MoveRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RequiredLegend, RequiredMark } from '@/components/shared/required-mark';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { DEPARTMENT_PERMISSIONS, USER_PERMISSIONS } from '@auth-sso/contracts';
import { enableStatus } from '@/lib/status-label';
import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '../actions';
import { bulkMoveDepartmentsAction } from '../bulk-actions';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { FieldError } from '@/components/shared/field-error';

import { SearchInput } from '@/components/shared/search-input';
import { TableToolbar } from '@/components/shared/table-toolbar';
interface DeptTreeNode {
  id: string;
  
  parentId: string | null;
  name: string;
  code: string | null;
  sort: number;
  status: string;
  children: DeptTreeNode[];
}

/** 删除确认的影响面（U-DEP05），与服务端删除守卫同口径 */
export interface DepartmentDeletionStats {
  childCount: number;
  userCount: number;
  roleCount: number;
}

/** 排序方式（U-DEP04）：默认=后端 sort 字段顺序；名称/编码=按中文/字典序 */
export type DepartmentSortKey = 'default' | 'name' | 'code';

/**
 * 递归排序部门树（U-DEP04）。
 *
 * 只排**同级兄弟**，不改变父子层级；`default` 保持后端返回顺序（`departments.sort`）。
 * 名称用 `localeCompare('zh-Hans-CN')` —— 按拼音而非 Unicode 码点，中文用户可预期。
 */
export function sortDepartmentTree(nodes: DeptTreeNode[], key: DepartmentSortKey): DeptTreeNode[] {
  if (key === 'default') return nodes;
  const compare = key === 'name'
    ? (a: DeptTreeNode, b: DeptTreeNode) => a.name.localeCompare(b.name, 'zh-Hans-CN')
    : (a: DeptTreeNode, b: DeptTreeNode) => (a.code ?? '').localeCompare(b.code ?? '');
  return [...nodes]
    .sort(compare)
    .map((node) => ({ ...node, children: sortDepartmentTree(node.children ?? [], key) }));
}

interface Props {
  departments: DeptTreeNode[];
  /** deptId → 子部门/直属用户/角色数量（删除确认弹窗展示，U-DEP05） */
  deletionStats?: Record<string, DepartmentDeletionStats>;
  /** 工作台快捷入口 /departments?create=1 自动打开 */
  autoOpenCreate?: boolean;
}

/** 扁平化树节点（含深度） */
function flattenTree(nodes: DeptTreeNode[], depth = 0): Array<DeptTreeNode & { depth: number }> {
  let result: Array<DeptTreeNode & { depth: number }> = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    if (node.children?.length) result = result.concat(flattenTree(node.children, depth + 1));
  }
  return result;
}

export default function DepartmentTree({ departments, deletionStats = {}, autoOpenCreate = false }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState<DepartmentSortKey>('default');
  /** 默认展开根节点（否则 40+ 部门只显示 root，用户需逐层点开） */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(departments.filter((d) => !d.parentId).map((d) => d.id)));
  const [saving, setSaving] = useState(false);

  // 弹窗
  const [isAddOpen, setIsAddOpen] = useState(autoOpenCreate);
  // 批量移动：仅非根部门可移动；目标父级不能是选中项（服务端还会做循环/作用域校验）
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveParentId, setMoveParentId] = useState('');
  const [moving, setMoving] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<DeptTreeNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeptTreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: '', code: '', sort: 0,
    parentId: (autoOpenCreate ? departments.find((d) => !d.parentId)?.id ?? null : null) as string | null,
    status: 'ACTIVE',
  });
  /** 具体错误码（如 DEPARTMENT_ALREADY_EXISTS）落到对应输入框（#92） */
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['code']);

  useEffect(() => {
    if (!fieldError) return;
    const inputId = isEditOpen ? 'dept-edit-code' : 'dept-code';
    requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  }, [fieldError, isEditOpen]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const closeAddDialog = () => {
    setIsAddOpen(false);
    if (!autoOpenCreate) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    const qs = params.toString();
    router.replace(`/departments${qs ? `?${qs}` : ''}`);
  };

  const openAdd = (parent?: string) => { setForm({ name: '', code: '', sort: 0, parentId: parent || null, status: 'ACTIVE' }); setIsAddOpen(true); };
  /** 对话框统一改为 `<form>` 提交（U-G06）：Enter 与点击主按钮行为一致 */
  const submitCreate = (e: React.FormEvent) => { e.preventDefault(); void handleCreate(); };
  const submitUpdate = (e: React.FormEvent) => { e.preventDefault(); void handleUpdate(); };
  const openEdit = (dept: DeptTreeNode) => { setSelected(dept); setForm({ name: dept.name, code: dept.code || '', sort: dept.sort, parentId: dept.parentId, status: dept.status }); setIsEditOpen(true); };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error('请填写部门名称');
      requestAnimationFrame(() => document.getElementById('dept-name')?.focus());
      return;
    }
    clearFailure();
    setSaving(true);
    const r = await createDepartmentAction({ name: form.name, code: form.code.trim() || undefined, sort: form.sort, parentId: form.parentId });
    setSaving(false);
    if (r.success) { toast.success(r.message); closeAddDialog(); router.refresh(); } else { reportFailure(r); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    if (!form.name.trim()) {
      toast.error('请填写部门名称');
      requestAnimationFrame(() => document.getElementById('dept-edit-name')?.focus());
      return;
    }
    clearFailure();
    setSaving(true);
    const r = await updateDepartmentAction(selected.id, { ...form, code: form.code.trim() || null });
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); } else { reportFailure(r); }
  };

  /** 删除只用闭包参数（首击读旧 `selected` 会静默无效，见审计 P1-3） */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const r = await deleteDepartmentAction(deleteTarget.id);
    setDeleting(false);
    if (r.success) {
      toast.success(r.message);
      setDeleteTarget(null);
      router.refresh();
    } else {
      // 失败（有子部门/用户/角色、根部门等）保留确认框，用户能读完原因再决定
      reportFailure(r);
    }
  };

  const sortedTree = useMemo(() => sortDepartmentTree(departments, sortKey), [departments, sortKey]);

  const flatList = useMemo(() => flattenTree(sortedTree), [sortedTree]);
  const flatDepts = useMemo(() => {
    const out: Array<{ id: string; name: string; depth: number }> = [];
    const walk = (nodes: DeptTreeNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ id: n.id, name: n.name, depth });
        walk(n.children, depth + 1);
      }
    };
    walk(departments, 0);
    return out;
  }, [departments]);
  const movableDepts = flatDepts.filter((d) => d.depth > 0);
  const selectedCount = selectedDepts.size;
  const selectedMoveNames = movableDepts.filter((d) => selectedDepts.has(d.id)).map((d) => d.name);
  // 选中父+子时只把顶层部门作为移动项；子部门随父级移动
  const allNodes = flattenTree(departments);
  const parentById = new Map(allNodes.map((d) => [d.id, d.parentId]));
  const statusById = new Map(allNodes.map((d) => [d.id, d.status]));
  const selectedRootIds = [...selectedDepts].filter((id) => {
    let parent = parentById.get(id) ?? null;
    while (parent) {
      if (selectedDepts.has(parent)) return false;
      parent = parentById.get(parent) ?? null;
    }
    return true;
  });
  const moveCount = selectedRootIds.length;
  const selectedRootSet = new Set(selectedRootIds);
  const isDescendantOfSelectedRoot = (id: string) => {
    let parent = parentById.get(id) ?? null;
    while (parent) {
      if (selectedRootSet.has(parent)) return true;
      parent = parentById.get(parent) ?? null;
    }
    return false;
  };
  // 目标不能是已选部门、其后代（会成环）或已禁用部门（服务端会拒）
  const moveTargets = flatDepts.filter(
    (d) => !selectedDepts.has(d.id) && statusById.get(d.id) === 'ACTIVE' && !isDescendantOfSelectedRoot(d.id),
  );

  const expandableIds = useMemo(
    () => flatList.filter((d) => (d.children?.length ?? 0) > 0).map((d) => d.id),
    [flatList],
  );

  /** 搜索命中节点集合（null = 非搜索态）；未命中的可见行只是“祖先路径”（U-DEP02） */
  const searchMatchIds = useMemo<Set<string> | null>(() => {
    const kw = keyword.trim();
    if (!kw) return null;
    const ids = new Set<string>();
    const walk = (nodes: DeptTreeNode[]) => {
      for (const node of nodes) {
        if (node.name.includes(kw) || (node.code?.includes(kw) ?? false)) ids.add(node.id);
        walk(node.children ?? []);
      }
    };
    walk(sortedTree);
    return ids;
  }, [sortedTree, keyword]);

  /**
   * 可见行：**真正**按 expanded 折叠（此前 toggle 只换图标，子行始终渲染）。
   * 搜索时忽略展开状态，并保留命中节点的祖先链，避免"搜索到了但父级收起看不到"。
   */
  const filtered = useMemo(() => {
    if (!keyword) {
      const out: Array<DeptTreeNode & { depth: number }> = [];
      const walk = (nodes: DeptTreeNode[], depth: number) => {
        for (const node of nodes) {
          out.push({ ...node, depth });
          if (expanded.has(node.id) && node.children?.length) walk(node.children, depth + 1);
        }
      };
      walk(sortedTree, 0);
      return out;
    }
    const kw = keyword.trim();
    const searchWalk = (nodes: DeptTreeNode[], depth: number): Array<DeptTreeNode & { depth: number }> => {
      const out: Array<DeptTreeNode & { depth: number }> = [];
      for (const node of nodes) {
        const children = searchWalk(node.children ?? [], depth + 1);
        const selfHit = node.name.includes(kw) || (node.code?.includes(kw) ?? false);
        if (selfHit || children.length > 0) {
          out.push({ ...node, depth });
          out.push(...children);
        }
      }
      return out;
    };
    return searchWalk(sortedTree, 0);
  }, [sortedTree, expanded, keyword]);

  /** 删除影响面：只列出非零依赖；无依赖时明确可直接删除 */
  const deletionImpactFor = (deptId: string) => {
    const stats = deletionStats[deptId] ?? { childCount: 0, userCount: 0, roleCount: 0 };
    const parts: string[] = [];
    if (stats.childCount > 0) parts.push(`子部门 ${stats.childCount} 个`);
    if (stats.userCount > 0) parts.push(`直属用户 ${stats.userCount} 人`);
    if (stats.roleCount > 0) parts.push(`角色 ${stats.roleCount} 个`);
    return {
      text: parts.length > 0 ? parts.join('、') : '无子部门、直属用户或角色',
      hasDependency: parts.length > 0,
    };
  };
  const deleteImpact = deleteTarget ? deletionImpactFor(deleteTarget.id) : null;

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
      {/* 根部门是 ADR-002 的单例（系统预置角色绑在根、根不可删）：非空树里再建根
          会落在所有角色子树之外 ⇒ 对任何管理员都不可见（审计 P1-1）。仅空树引导期放出。 */}
      <TableToolbar
        left={
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="type-section-title shrink-0 text-foreground">部门管理</h1>
            <SearchInput placeholder="搜索部门..." value={keyword} onChange={setKeyword} />
          </div>
        }
        right={
          <>
            {departments.length > 0 ? (
              <>
                <PermissionGuard permission={DEPARTMENT_PERMISSIONS.CREATE}>
                  <Button onClick={() => openAdd(departments.find((d) => !d.parentId)?.id)}>
                    <Plus className="h-4 w-4" /> 新建部门
                  </Button>
                </PermissionGuard>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-md:w-full">
                  排序
                  <select
                    aria-label="部门排序方式"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as DepartmentSortKey)}
                    className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground max-md:flex-1"
                  >
                    <option value="default">默认顺序</option>
                    <option value="name">按名称</option>
                    <option value="code">按编码</option>
                  </select>
                </label>
                <Button variant="outline" onClick={() => setExpanded(new Set(expandableIds))}>
                  展开全部
                </Button>
                <Button variant="outline" onClick={() => setExpanded(new Set())}>
                  收起全部
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedDepts((prev) => prev.size === movableDepts.length ? new Set() : new Set(movableDepts.map((d) => d.id)))}
                  disabled={movableDepts.length === 0}
                >
                  {selectedCount === movableDepts.length && movableDepts.length > 0 ? '取消全选' : '全选可移动'}
                </Button>
                {selectedCount > 0 && (
                  <Button variant="outline" onClick={() => { setMoveParentId(''); setMoveOpen(true); }}>
                    <MoveRight className="h-4 w-4" /> 移动到…（{moveCount}）
                  </Button>
                )}
              </>
            ) : null}
            {departments.length === 0 ? (
              <PermissionGuard permission={DEPARTMENT_PERMISSIONS.CREATE}>
                <Button onClick={() => openAdd()}>
                  <Plus className="h-4 w-4" /> 新建根部门
                </Button>
              </PermissionGuard>
            ) : null}
          </>
        }
      />
      <CardContent className="p-0">
        <div className="divide-y">
          {filtered.map(dept => {
            // 搜索态下未命中的可见行只是祖先路径：只作路径展示，不渲染编辑/删除（U-DEP02）
            const pathOnly = searchMatchIds !== null && !searchMatchIds.has(dept.id);
            return (
            <div
              key={dept.id}
              data-dept-row={dept.id}
              // 390px：允许换行（操作组整体折到第二行），并以 min-w 守住名称宽度，
              // 避免操作列把名称挤成逐字竖排 / 操作被 Card overflow-hidden 裁掉（U-DEP01）
              className="flex flex-wrap items-center gap-2 px-3 py-1.5 transition-colors hover:bg-muted/40"
              style={{ paddingLeft: `${16 + dept.depth * 20}px` }}
            >
              <Checkbox
                aria-label={`选择部门 ${dept.name}`}
                checked={selectedDepts.has(dept.id)}
                disabled={dept.depth === 0}
                onCheckedChange={(checked) => setSelectedDepts((prev) => {
                  const next = new Set(prev);
                  if (checked === true) next.add(dept.id); else next.delete(dept.id);
                  return next;
                })}
              />
              {(dept.children?.length ?? 0) > 0 ? (
                <Button variant="ghost" size="icon-sm" aria-label={expanded.has(dept.id) ? `收起 ${dept.name} 的子部门` : `展开 ${dept.name} 的子部门`} aria-expanded={expanded.has(dept.id)} className="shrink-0" onClick={() => toggleExpand(dept.id)}>
                  {expanded.has(dept.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              ) : <div className="w-8 shrink-0" />}
              <Building2 className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
              <div data-dept-name className="min-w-[8rem] flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-medium" title={dept.name}>{dept.name}</span>
                  {dept.code && <code className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">{dept.code}</code>}
                </div>
              </div>
              <Badge variant={enableStatus(dept.status).variant} className="shrink-0">{enableStatus(dept.status).label}</Badge>
              {pathOnly ? (
                <Badge variant="outline" className="ml-auto shrink-0" data-path-only>路径</Badge>
              ) : (
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                <PermissionGuard permission={DEPARTMENT_PERMISSIONS.CREATE}>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" aria-label={`添加子部门 ${dept.name}`} onClick={() => openAdd(dept.id)} title="添加子部门"><Plus className="h-4 w-4" /><span>子部门</span></Button>
                </PermissionGuard>
                <PermissionGuard permission={USER_PERMISSIONS.LIST}>
                  <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2" aria-label={`查看成员 ${dept.name}`} title="在用户管理中查看直属成员">
                    <Link href={`/users?deptId=${encodeURIComponent(dept.id)}`}>
                      <Users className="h-3.5 w-3.5" /><span>成员 {deletionStats[dept.id]?.userCount ?? 0}</span>
                    </Link>
                  </Button>
                </PermissionGuard>
                <PermissionGuard permission={DEPARTMENT_PERMISSIONS.UPDATE}>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" aria-label={`编辑部门 ${dept.name}`} title="编辑部门" onClick={() => openEdit(dept)}>
                    <Edit className="h-4 w-4" /><span>编辑</span>
                  </Button>
                </PermissionGuard>
                {/* 根部门是单例（ADR-002），领域 guard 禁止删除：不显示会被拒绝的按钮 */}
                {dept.depth > 0 ? (
                  <PermissionGuard permission={DEPARTMENT_PERMISSIONS.DELETE}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`删除部门 ${dept.name}`}
                      title="删除部门"
                      className="h-7 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteTarget(dept)}
                    >
                      <Trash2 className="h-4 w-4" /><span>删除</span>
                    </Button>
                  </PermissionGuard>
                ) : <div className="w-8" />}
              </div>
              )}
            </div>
            );
          })}
          {filtered.length === 0 && (
            keyword ? (
              <EmptyState
                variant="simple"
                icon="Building2"
                title="没有匹配的部门"
                description={`未找到名称或编码包含「${keyword}」的部门`}
                clearAction={{ label: '清除搜索', onClick: () => setKeyword('') }}
              />
            ) : (
              <EmptyState variant="simple" icon="Building2" title="暂无部门" description="创建组织架构以开始管理" action={{ label: '创建根部门', onClick: () => openAdd() }} />
            )
          )}
        </div>
      </CardContent>

      {/* 批量移动对话框 */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MoveRight className="h-4 w-4 text-primary" /> 移动 {moveCount} 个部门</DialogTitle>
            <DialogDescription>
              选择新的父部门。已选中的子部门会随父级一起移动，无需单独勾选；目标列表已排除选中部门及其子部门、以及已禁用部门。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="move-parent">目标父部门</Label>
            <select
              id="move-parent"
              aria-label="目标父部门"
              value={moveParentId}
              onChange={(e) => setMoveParentId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px]"
            >
              <option value="">请选择目标父部门</option>
              {moveTargets.map((d) => (
                <option key={d.id} value={d.id}>{'　'.repeat(d.depth)}{d.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground" title={selectedMoveNames.join('、') || '—'}>
              已选：{selectedMoveNames.slice(0, 5).join('、') || '—'}
              {selectedMoveNames.length > 5 ? ` 等 ${selectedMoveNames.length} 个部门` : ''}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)} disabled={moving}>取消</Button>
            <Button
              disabled={moving || !moveParentId}
              onClick={async () => {
                setMoving(true);
                try {
                  const res = await bulkMoveDepartmentsAction([...selectedDepts], moveParentId);
                  if (res.success) {
                    toast.success((res as { message?: string }).message ?? '部门已移动');
                    setSelectedDepts(new Set());
                    setMoveOpen(false);
                    router.refresh();
                  } else {
                    reportFailure(res, '移动失败');
                  }
                } finally {
                  setMoving(false);
                }
              }}
            >
              {moving ? '移动中...' : '确认移动'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新增对话框 */}
      <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) closeAddDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> 新建部门</DialogTitle></DialogHeader>
          <form onSubmit={submitCreate}>
            <p className="pt-3 text-[11px] text-muted-foreground"><RequiredLegend /></p>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><div className="flex items-center gap-1"><Label htmlFor="dept-name">部门名称</Label><RequiredMark /></div><Input id="dept-name" aria-required="true" value={form.name} maxLength={100} onChange={e => setForm({...form, name: e.target.value})} placeholder="技术部" /></div>
              <div className="space-y-2"><Label htmlFor="dept-code">部门编码</Label><Input id="dept-code" aria-describedby={fieldError?.field === 'code' ? 'dept-code-error' : undefined} value={form.code} maxLength={50} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} placeholder="tech" /></div>
              <FieldError failure={fieldError} field="code" id="dept-code-error" />
              <div className="space-y-2"><Label htmlFor="dept-sort">排序（越小越靠前）</Label><Input id="dept-sort" type="number" value={form.sort} onChange={e => setForm({...form, sort: Number(e.target.value)})} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeAddDialog}>取消</Button>
              <Button type="submit" disabled={saving}>{saving ? '创建中...' : '创建'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑部门</DialogTitle></DialogHeader>
          <form onSubmit={submitUpdate}>
            <p className="pt-3 text-[11px] text-muted-foreground"><RequiredLegend /></p>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><div className="flex items-center gap-1"><Label htmlFor="dept-edit-name">部门名称</Label><RequiredMark /></div><Input id="dept-edit-name" aria-required="true" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              <div className="space-y-2"><Label htmlFor="dept-edit-code">部门编码</Label><Input id="dept-edit-code" aria-describedby={fieldError?.field === 'code' ? 'dept-edit-code-error' : undefined} value={form.code} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} /></div>
              <FieldError failure={fieldError} field="code" id="dept-edit-code-error" />
              <div className="space-y-2"><Label htmlFor="dept-edit-sort">排序（越小越靠前）</Label><Input id="dept-edit-sort" type="number" value={form.sort} onChange={e => setForm({...form, sort: Number(e.target.value)})} /></div>
              <div className="space-y-2">
                <Label htmlFor="dept-edit-status">状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm({...form, status: v})} disabled={selected?.parentId === null}>
                  <SelectTrigger id="dept-edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">启用</SelectItem>
                    <SelectItem value="DISABLED">停用</SelectItem>
                  </SelectContent>
                </Select>
                {selected?.parentId === null ? (
                  <p className="text-[10px] leading-4 text-muted-foreground">根部门为组织树单例，不可停用。</p>
                ) : form.status === 'DISABLED' ? (
                  <p className="rounded bg-badge-warning-bg px-2 py-1 text-[10px] leading-4 text-badge-warning-fg">
                    停用后不能再向该部门新增用户/角色/子部门；已有对象保留，可随时恢复启用。
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>取消</Button>
              <Button type="submit" disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除确认（危险操作统一走设计系统弹窗） */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除部门「{deleteTarget?.name}」？</DialogTitle>
            <DialogDescription>删除前请确认该部门下没有子部门、用户与角色，此操作不可撤销。</DialogDescription>
          </DialogHeader>
          {deleteTarget && deleteImpact && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-delete-impact>
              影响面：{deleteImpact.text}。{deleteImpact.hasDependency ? '存在依赖时服务端会拒绝删除。' : '可直接删除。'}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

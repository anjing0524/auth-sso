'use client';

/**
 * 部门树交互组件 — 展开/折叠、搜索、增删改
 * 写操作通过 Server Actions 直调，不调 REST API
 */
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Building2, Plus, ChevronRight, ChevronDown, Edit, Trash2, Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/empty-state';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { DEPARTMENT_PERMISSIONS, USER_PERMISSIONS } from '@auth-sso/contracts';
import { enableStatus } from '@/lib/status-label';
import { DepartmentMembersDialog } from './DepartmentMembersDialog';
import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '../actions';
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

interface Props {
  departments: DeptTreeNode[];
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

export default function DepartmentTree({ departments }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  /** 默认展开根节点（否则 40+ 部门只显示 root，用户需逐层点开） */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(departments.filter((d) => !d.parentId).map((d) => d.id)));
  const [saving, setSaving] = useState(false);

  // 弹窗
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<DeptTreeNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeptTreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [membersTarget, setMembersTarget] = useState<DeptTreeNode | null>(null);
  const [form, setForm] = useState({ name: '', code: '', sort: 0, parentId: '' as string | null });
  /** 具体错误码（如 DEPARTMENT_ALREADY_EXISTS）落到对应输入框（#92） */
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['code']);

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const openAdd = (parent?: string) => { setForm({ name: '', code: '', sort: 0, parentId: parent || null }); setIsAddOpen(true); };
  const openEdit = (dept: DeptTreeNode) => { setSelected(dept); setForm({ name: dept.name, code: dept.code || '', sort: dept.sort, parentId: dept.parentId }); setIsEditOpen(true); };

  const handleCreate = async () => {
    if (!form.name) { toast.error('请填写部门名称'); return; }
    clearFailure();
    setSaving(true);
    const r = await createDepartmentAction({ name: form.name, code: form.code || undefined, sort: form.sort, parentId: form.parentId });
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsAddOpen(false); router.refresh(); } else { reportFailure(r); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    clearFailure();
    setSaving(true);
    const r = await updateDepartmentAction(selected.id, form);
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); } else { reportFailure(r); }
  };

  /** 删除只用闭包参数（首击读旧 `selected` 会静默无效，见审计 P1-3） */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const r = await deleteDepartmentAction(deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (r.success) { toast.success(r.message); router.refresh(); } else { reportFailure(r); }
  };

  const flatList = useMemo(() => flattenTree(departments), [departments]);
  const expandableIds = useMemo(
    () => flatList.filter((d) => (d.children?.length ?? 0) > 0).map((d) => d.id),
    [flatList],
  );

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
      walk(departments, 0);
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
    return searchWalk(departments, 0);
  }, [departments, expanded, keyword]);

  return (
    <Card className="overflow-hidden">
      {/* 根部门是 ADR-002 的单例（系统预置角色绑在根、根不可删）：非空树里再建根
          会落在所有角色子树之外 ⇒ 对任何管理员都不可见（审计 P1-1）。仅空树引导期放出。 */}
      <TableToolbar
        left={<SearchInput placeholder="搜索部门..." value={keyword} onChange={setKeyword} />}
        right={
          <>
            {departments.length > 0 ? (
              <>
                <Button variant="outline" onClick={() => setExpanded(new Set(expandableIds))}>
                  展开全部
                </Button>
                <Button variant="outline" onClick={() => setExpanded(new Set())}>
                  收起全部
                </Button>
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
          {filtered.map(dept => (
            <div key={dept.id} className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/50" style={{ paddingLeft: `${24 + dept.depth * 24}px` }}>
              {(dept.children?.length ?? 0) > 0 ? (
                <Button variant="ghost" size="icon" aria-label={expanded.has(dept.id) ? '收起子部门' : '展开子部门'} aria-expanded={expanded.has(dept.id)} className="h-8 w-8 rounded-lg" onClick={() => toggleExpand(dept.id)}>
                  {expanded.has(dept.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              ) : <div className="w-8" />}
              <Building2 className="h-4 w-4 shrink-0 text-primary" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{dept.name}</span>
                  {dept.code && <code className="font-mono text-xs text-muted-foreground">{dept.code}</code>}
                </div>
              </div>
              <Badge variant={enableStatus(dept.status).variant} className="shrink-0">{enableStatus(dept.status).label}</Badge>
              <div className="flex items-center gap-1 shrink-0">
                <PermissionGuard permission={DEPARTMENT_PERMISSIONS.CREATE}>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label="添加子部门" onClick={() => openAdd(dept.id)} title="添加子部门"><Plus className="h-4 w-4" /><span>子部门</span></Button>
                </PermissionGuard>
                <PermissionGuard permission={USER_PERMISSIONS.LIST}>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label="查看成员" title="查看成员" onClick={() => setMembersTarget(dept)}>
                    <Users className="h-4 w-4" /><span>成员</span>
                  </Button>
                </PermissionGuard>
                <PermissionGuard permission={DEPARTMENT_PERMISSIONS.UPDATE}>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label="编辑部门" title="编辑部门" onClick={() => openEdit(dept)}>
                    <Edit className="h-4 w-4" /><span>编辑</span>
                  </Button>
                </PermissionGuard>
                {/* 根部门是单例（ADR-002），领域 guard 禁止删除：不显示会被拒绝的按钮 */}
                {dept.depth > 0 ? (
                  <PermissionGuard permission={DEPARTMENT_PERMISSIONS.DELETE}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="删除部门"
                      title="删除部门"
                      className="h-8 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteTarget(dept)}
                    >
                      <Trash2 className="h-4 w-4" /><span>删除</span>
                    </Button>
                  </PermissionGuard>
                ) : <div className="w-8" />}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            keyword ? (
              <EmptyState variant="simple" icon="Building2" title="没有匹配的部门" description={`未找到名称或编码包含「${keyword}」的部门`} />
            ) : (
              <EmptyState variant="simple" icon="Building2" title="暂无部门" description="创建组织架构以开始管理" action={{ label: '创建根部门', onClick: () => openAdd() }} />
            )
          )}
        </div>
      </CardContent>

      {/* 新增对话框 */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> 新建部门</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>部门名称</Label><Input value={form.name} maxLength={100} onChange={e => setForm({...form, name: e.target.value})} placeholder="技术部" /></div>
            <div className="space-y-2"><Label>部门编码</Label><Input value={form.code} maxLength={50} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} placeholder="tech" /></div>
            <FieldError failure={fieldError} field="code" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? '创建中...' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑部门</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>部门名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>部门编码</Label><Input value={form.code} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} /></div>
            <FieldError failure={fieldError} field="code" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>取消</Button>
            <Button onClick={handleUpdate} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认（危险操作统一走设计系统弹窗） */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除部门「{deleteTarget?.name}」？</DialogTitle>
            <DialogDescription>删除前请确认该部门下没有子部门、用户与角色，此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {membersTarget && (
        <DepartmentMembersDialog
          open={!!membersTarget}
          onOpenChange={(open) => { if (!open) setMembersTarget(null); }}
          departmentId={membersTarget.id}
          departmentName={membersTarget.name}
        />
      )}
    </Card>
  );
}

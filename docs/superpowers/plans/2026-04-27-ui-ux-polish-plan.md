# UI/UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement UI/UX polish across the Auth-SSO portal, including dashboard skeleton loading, sticky form footers, and micro-interactions like password visibility and search clearing.

**Architecture:** We will modify existing React server and client components in the Next.js `apps/portal` directory using Tailwind CSS for styling and Radix UI primitives where applicable.

**Tech Stack:** Next.js (React), Tailwind CSS, Lucide Icons

---

### Task 1: Dashboard UI Polish

**Files:**
- Modify: `apps/portal/src/app/dashboard/page.tsx`

- [ ] **Step 1: Align header elements and add card hover effects**

```typescript
// In apps/portal/src/app/dashboard/page.tsx
// 1. Find the header: `<div className="flex items-center justify-between mb-8">`
// Change it to ensure vertical center alignment if not already perfect (it usually is with items-center, but let's be explicit).
// 2. Add hover styles to the 4 statistic cards. Find the `Card` components for users, roles, apps, status.
// Add `hover:bg-primary-50 transition-all duration-200 ease-out` to their className.
// Since Tailwind uses specific colors, we'll use `hover:bg-[#E6F0FF]`.
```

*Implementation detail for Step 1:*
Replace the 4 `<Card className="rounded-[1.25rem] border-none shadow-sm ring-1 ring-border/50">` with `<Card className="rounded-[1.25rem] border-none shadow-sm ring-1 ring-border/50 hover:bg-[#E6F0FF] transition-all duration-200 ease-out">`.

- [ ] **Step 2: Update Audit Logs empty state with a skeleton**

```typescript
// In apps/portal/src/app/dashboard/page.tsx
// Find the `recentLogs.length === 0` rendering block:
/*
<TableCell colSpan={4} className="h-64 text-center">
  <div className="flex flex-col items-center justify-center space-y-3 opacity-60">
    <div className="bg-slate-100 p-3 rounded-full">
      <History className="h-6 w-6 text-slate-400" />
    </div>
    <p className="text-sm font-medium text-slate-500">暂无活动记录</p>
    <p className="text-xs text-slate-400">系统的最新安全审计日志将在这里显示</p>
  </div>
</TableCell>
*/
// Replace with a Skeleton table view + overlay text.
// Note: We need to import Skeleton from `@/components/ui/skeleton` if it's not imported.
```

*Implementation detail for Step 2:*
```typescript
// Replace the empty state TableCell with:
<TableCell colSpan={4} className="h-64 p-0 relative">
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10 space-y-3">
    <div className="bg-slate-100 p-3 rounded-full">
      <History className="h-6 w-6 text-slate-400" />
    </div>
    <p className="text-sm font-medium text-slate-500">暂无活动记录</p>
    <p className="text-xs text-slate-400">系统的最新安全审计日志将在这里显示</p>
  </div>
  {/* Skeleton Rows */}
  <div className="w-full flex flex-col gap-4 p-6 opacity-30">
    {[1, 2, 3].map((i) => (
      <div key={i} className="flex items-center gap-4">
        <div className="h-4 bg-slate-200 rounded w-1/4"></div>
        <div className="h-4 bg-slate-200 rounded w-1/4"></div>
        <div className="h-4 bg-slate-200 rounded w-1/4"></div>
        <div className="h-4 bg-slate-200 rounded w-1/4"></div>
      </div>
    ))}
  </div>
</TableCell>
```

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/dashboard/page.tsx
git commit -m "style: polish dashboard layout, hover states and empty skeleton"
```

### Task 2: Sticky Footer for New User Form and Password Eye Icon

**Files:**
- Modify: `apps/portal/src/app/users/new/page.tsx`

- [ ] **Step 1: Add state for password visibility**

```typescript
// In apps/portal/src/app/users/new/page.tsx
// Add import: `import { Eye, EyeOff } from 'lucide-react';`
// Inside the component:
// const [showPassword, setShowPassword] = useState(false);
```

- [ ] **Step 2: Add sticky footer and update password input**

```typescript
// In apps/portal/src/app/users/new/page.tsx
// 1. Remove the header buttons:
/*
<div className="flex gap-3">
  <Button variant="ghost" className="rounded-xl px-6" asChild>
     <Link href="/users">取消</Link>
  </Button>
  <Button onClick={handleCreate} disabled={saving} className="rounded-xl px-8 shadow-lg shadow-primary/20">
    {saving ? '创建中...' : <><UserPlus className="mr-2 h-4 w-4" /> 确认创建</>}
  </Button>
</div>
*/

// 2. Change the password input to add the eye toggle:
/*
<div className="relative">
  <Input
    type={showPassword ? "text" : "password"}
    placeholder="设置用户初始密码"
    value={newUser.password}
    onChange={e => setNewUser({...newUser, password: e.target.value})}
    className="pr-10"
  />
  <button
    type="button"
    onClick={() => setShowPassword(!showPassword)}
    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
  >
    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
  </button>
</div>
*/

// 3. Add the Sticky Footer at the very bottom of the main `div`:
/*
{/* Sticky Footer */}
<div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white border-t border-slate-200 p-4 px-8 flex justify-end gap-4 z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
  <Button variant="ghost" className="rounded-xl px-6" asChild>
     <Link href="/users">取消</Link>
  </Button>
  <Button onClick={handleCreate} disabled={saving} className="rounded-xl px-8 shadow-lg shadow-primary/20">
    {saving ? '创建中...' : <><UserPlus className="mr-2 h-4 w-4" /> 确认创建</>}
  </Button>
</div>
*/
```

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/users/new/page.tsx
git commit -m "feat: add sticky footer and password visibility toggle to user form"
```

### Task 3: Modal Backdrop Blur and Select Helper Text

**Files:**
- Modify: `apps/portal/src/app/roles/page.tsx`

- [ ] **Step 1: Fix backdrop blur in Dialog and add Helper Text**

```typescript
// In apps/portal/src/app/roles/page.tsx
// 1. For the Dialog, the default Radix DialogOverlay might have strong blur. We need to pass a custom className or modify the global UI component if needed. Since we are modifying `roles/page.tsx`, let's see if we can pass a className to `DialogContent` or `Dialog` if it accepts an overlay prop, OR we might need to modify `apps/portal/src/components/ui/dialog.tsx`.
// Wait, the standard shadcn/ui dialog has the overlay in `dialog.tsx`.
// Let's modify `apps/portal/src/components/ui/dialog.tsx` instead of `roles/page.tsx` for the overlay blur.
```

*Wait, let's modify the plan to touch `dialog.tsx` for the blur, and `roles/page.tsx` for the helper text and search clear.*

**Files:**
- Modify: `apps/portal/src/components/ui/dialog.tsx`
- Modify: `apps/portal/src/app/roles/page.tsx`

- [ ] **Step 1: Update Dialog Overlay**

```typescript
// In apps/portal/src/components/ui/dialog.tsx
// Find `DialogOverlay` component.
// Change className from `bg-black/80 backdrop-blur-sm` (or similar) to:
// `bg-slate-900/30 backdrop-blur-[4px]`
```

- [ ] **Step 2: Add Select Helper Text and Search Clear in Roles**

```typescript
// In apps/portal/src/app/roles/page.tsx
// 1. Add Helper Text under the Select:
/*
<Select value={newRole.dataScopeType} onValueChange={(v: any) => setNewRole({...newRole, dataScopeType: v})}>
  <SelectTrigger className="rounded-xl h-11">
    <SelectValue placeholder="选择范围" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="ALL">全量数据</SelectItem>
    <SelectItem value="DEPT">本部门</SelectItem>
    <SelectItem value="SELF">仅本人</SelectItem>
  </SelectContent>
</Select>
<p className="text-[12px] text-gray-500 mt-1">
  {newRole.dataScopeType === 'ALL' ? '可以访问系统内所有数据' : 
   newRole.dataScopeType === 'DEPT' ? '仅能访问所在部门及子部门的数据' : 
   newRole.dataScopeType === 'SELF' ? '仅能访问自己创建的数据' : '请选择数据范围以限制该角色权限'}
</p>
*/

// 2. Add Clear button to Search:
// Import X or XCircle from lucide-react.
/*
<div className="relative">
  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground opacity-50" />
  <Input
    placeholder="搜索角色名称或编码..."
    className="pl-10 pr-10 h-11 rounded-xl bg-white border-slate-200 focus:ring-2 focus:ring-primary/10 transition-all"
    value={keyword}
    onChange={(e) => setKeyword(e.target.value)}
  />
  {keyword && (
    <button onClick={() => setKeyword('')} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
      <X className="h-4 w-4" />
    </button>
  )}
</div>
*/
```

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/components/ui/dialog.tsx apps/portal/src/app/roles/page.tsx
git commit -m "style: reduce modal backdrop blur and add select helper text / search clear"
```

### Task 4: Menus Empty State Polish

**Files:**
- Modify: `apps/portal/src/app/menus/page.tsx`

- [ ] **Step 1: Update empty state**

```typescript
// In apps/portal/src/app/menus/page.tsx
// Find the `filteredMenus.length === 0` rendering block:
/*
<TableRow>
  <TableCell colSpan={6} className="h-64 text-center text-muted-foreground italic">
    未找到匹配的菜单项
  </TableCell>
</TableRow>
*/

// Replace with a better empty state with a button:
/*
<TableRow>
  <TableCell colSpan={6} className="h-64 text-center">
    <div className="flex flex-col items-center justify-center space-y-4">
      <div className="bg-primary/10 p-4 rounded-full">
        <MenuIcon className="h-8 w-8 text-primary" />
      </div>
      <div>
        <p className="text-base font-bold text-slate-700">{keyword ? '未找到匹配的菜单项' : '尚未配置菜单'}</p>
        <p className="text-sm text-slate-500 mt-1">{keyword ? '请尝试更换搜索词' : '创建菜单以构建系统导航结构'}</p>
      </div>
      {!keyword && (
        <Button onClick={() => setIsAddOpen(true)} className="rounded-xl px-6 mt-2 shadow-lg shadow-primary/20">
          <Plus className="mr-2 h-4 w-4" /> 创建第一个菜单
        </Button>
      )}
    </div>
  </TableCell>
</TableRow>
*/
// Ensure `Plus` is imported from `lucide-react`.
```

- [ ] **Step 2: Commit**

```bash
git add apps/portal/src/app/menus/page.tsx
git commit -m "feat: improve menus empty state with action button"
```

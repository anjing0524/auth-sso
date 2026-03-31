# Client Management Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement complete OAuth Client management with CRUD, Secret management, and Token viewing capabilities.

**Architecture:** Portal BFF provides REST API for Client management. Frontend pages use Next.js App Router with React components. Database uses existing `clients` and `oauth_access_tokens` tables via postgres.js.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS, postgres.js, TypeScript

---

## File Structure

### Backend API Files
```
apps/portal/src/app/api/clients/
├── route.ts                    # GET(list), POST(create)
└── [id]/
    ├── route.ts                # GET(detail), PUT(update), DELETE
    ├── secret/route.ts         # POST(regenerate secret)
    └── tokens/route.ts         # GET(list), DELETE(revoke)
```

### Frontend Pages
```
apps/portal/src/app/clients/
├── page.tsx                    # Client list page
└── [id]/
    └── page.tsx                # Client detail/edit page
```

### Shared Components
```
apps/portal/src/components/
├── layout/
│   └── DashboardLayout.tsx     # Dashboard layout with sidebar
└── clients/
    ├── ClientTable.tsx         # Client list table
    ├── ClientForm.tsx          # Client create/edit form
    └── TokenTable.tsx          # Token list table
```

---

## Phase 1: Backend API

### Task 1: Client List API (GET /api/clients)

**Files:**
- Create: `apps/portal/src/app/api/clients/route.ts`

- [ ] **Step 1: Create the route file with GET handler**

```typescript
/**
 * Client 管理 API
 * GET /api/clients - 获取 Client 列表
 * POST /api/clients - 创建 Client
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';

/**
 * 生成随机 ID
 */
function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成 Client ID
 */
function generateClientId(): string {
  return `client_${randomBytes(8).toString('hex')}`;
}

/**
 * 生成 Client Secret
 */
function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * GET /api/clients
 * 获取 Client 列表
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const keyword = searchParams.get('keyword') || '';
    const status = searchParams.get('status') || '';

    const offset = (page - 1) * pageSize;

    // 构建查询条件
    const conditions: string[] = [];
    if (keyword) {
      conditions.push(`(name ILIKE '%${keyword}%' OR client_id ILIKE '%${keyword}%')`);
    }
    if (status) {
      conditions.push(`status = '${status}'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const countResult = await sql`
      SELECT COUNT(*) as total FROM clients ${sql.unsafe(whereClause)}
    `;
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 查询列表
    const clients = await sql`
      SELECT
        id,
        public_id,
        name,
        client_id,
        redirect_uris,
        scopes,
        status,
        created_at,
        updated_at
      FROM clients
      ${sql.unsafe(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      data: clients.map((c: any) => ({
        id: c.id,
        publicId: c.public_id,
        name: c.name,
        clientId: c.client_id,
        redirectUris: JSON.parse(c.redirect_uris || '[]'),
        scopes: c.scopes,
        status: c.status,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[Clients] GET Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取 Client 列表失败' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test the API endpoint**

Run: `curl -s http://localhost:4000/api/clients | head -100`
Expected: JSON response with `data` array and `pagination` object

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/api/clients/route.ts
git commit -m "feat(client): add GET /api/clients list endpoint"
```

---

### Task 2: Client Create API (POST /api/clients)

**Files:**
- Modify: `apps/portal/src/app/api/clients/route.ts`

- [ ] **Step 1: Add POST handler to route.ts**

Append to `apps/portal/src/app/api/clients/route.ts`:

```typescript
/**
 * POST /api/clients
 * 创建 Client
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      redirectUris,
      scopes = 'openid profile email',
      accessTokenTtl = 3600,
      refreshTokenTtl = 604800,
      homepageUrl,
      logoUrl,
      skipConsent = false,
    } = body;

    // 验证必填字段
    if (!name || !redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
      return NextResponse.json(
        { error: 'invalid_params', message: '名称和回调地址不能为空' },
        { status: 400 }
      );
    }

    // 生成 ID 和凭证
    const id = generateId(20);
    const publicId = `client_${generateId(8)}`;
    const clientId = generateClientId();
    const clientSecret = generateClientSecret();

    // 创建 Client
    await sql`
      INSERT INTO clients (
        id, public_id, name, client_id, client_secret,
        redirect_uris, grant_types, scopes,
        access_token_ttl, refresh_token_ttl,
        homepage_url, logo_url, skip_consent,
        status, disabled, created_at, updated_at
      )
      VALUES (
        ${id}, ${publicId}, ${name}, ${clientId}, ${clientSecret},
        ${JSON.stringify(redirectUris)}, ${'["authorization_code","refresh_token"]'}, ${scopes},
        ${accessTokenTtl}, ${refreshTokenTtl},
        ${homepageUrl || null}, ${logoUrl || null}, ${skipConsent},
        'ACTIVE', false, NOW(), NOW()
      )
    `;

    return NextResponse.json({
      success: true,
      data: {
        id,
        publicId,
        clientId,
        clientSecret, // 仅创建时返回
        name,
        redirectUris,
        scopes,
        accessTokenTtl,
        refreshTokenTtl,
        homepageUrl,
        logoUrl,
        skipConsent,
        status: 'ACTIVE',
      },
    });
  } catch (error) {
    console.error('[Clients] POST Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '创建 Client 失败' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test the API endpoint**

Run: `curl -s -X POST http://localhost:4000/api/clients -H "Content-Type: application/json" -d '{"name":"Test App","redirectUris":["http://localhost:3000/callback"]}'`
Expected: JSON response with `success: true` and `clientSecret` field

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/api/clients/route.ts
git commit -m "feat(client): add POST /api/clients create endpoint"
```

---

### Task 3: Client Detail/Update/Delete API

**Files:**
- Create: `apps/portal/src/app/api/clients/[id]/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
/**
 * Client 单个操作 API
 * GET /api/clients/[id] - 获取详情
 * PUT /api/clients/[id] - 更新
 * DELETE /api/clients/[id] - 删除/禁用
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/clients/[id]
 * 获取 Client 详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const clients = await sql`
      SELECT
        id, public_id, name, client_id,
        redirect_uris, grant_types, scopes,
        access_token_ttl, refresh_token_ttl,
        homepage_url, logo_url, skip_consent,
        status, disabled, created_at, updated_at
      FROM clients
      WHERE id = ${id} OR public_id = ${id} OR client_id = ${id}
    `;

    if (clients.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const c = clients[0] as any;

    return NextResponse.json({
      data: {
        id: c.id,
        publicId: c.public_id,
        name: c.name,
        clientId: c.client_id,
        redirectUris: JSON.parse(c.redirect_uris || '[]'),
        grantTypes: JSON.parse(c.grant_types || '[]'),
        scopes: c.scopes,
        accessTokenTtl: c.access_token_ttl,
        refreshTokenTtl: c.refresh_token_ttl,
        homepageUrl: c.homepage_url,
        logoUrl: c.logo_url,
        skipConsent: c.skip_consent,
        status: c.status,
        disabled: c.disabled,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      },
    });
  } catch (error) {
    console.error('[Client] GET Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取 Client 详情失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/clients/[id]
 * 更新 Client
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      redirectUris,
      scopes,
      accessTokenTtl,
      refreshTokenTtl,
      homepageUrl,
      logoUrl,
      skipConsent,
      status,
    } = body;

    // 检查是否存在
    const existing = await sql`
      SELECT id FROM clients WHERE id = ${id} OR public_id = ${id} OR client_id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    // 更新
    await sql`
      UPDATE clients SET
        name = COALESCE(${name}, name),
        redirect_uris = COALESCE(${redirectUris ? JSON.stringify(redirectUris) : null}, redirect_uris),
        scopes = COALESCE(${scopes}, scopes),
        access_token_ttl = COALESCE(${accessTokenTtl}, access_token_ttl),
        refresh_token_ttl = COALESCE(${refreshTokenTtl}, refresh_token_ttl),
        homepage_url = ${homepageUrl || null},
        logo_url = ${logoUrl || null},
        skip_consent = COALESCE(${skipConsent}, skip_consent),
        status = COALESCE(${status}, status),
        disabled = CASE WHEN ${status} = 'DISABLED' THEN true WHEN ${status} = 'ACTIVE' THEN false ELSE disabled END,
        updated_at = NOW()
      WHERE id = ${(existing[0] as any).id}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Client] PUT Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '更新 Client 失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[id]
 * 删除 Client
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 检查是否存在
    const existing = await sql`
      SELECT id FROM clients WHERE id = ${id} OR public_id = ${id} OR client_id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    // 删除（级联删除关联的 token）
    await sql`DELETE FROM clients WHERE id = ${(existing[0] as any).id}`;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Client] DELETE Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '删除 Client 失败' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test the GET endpoint**

Run: `curl -s http://localhost:4000/api/clients/portal`
Expected: JSON response with Client detail (or 404 if not exists)

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/api/clients/[id]/route.ts
git commit -m "feat(client): add GET/PUT/DELETE /api/clients/[id] endpoints"
```

---

### Task 4: Client Secret Regenerate API

**Files:**
- Create: `apps/portal/src/app/api/clients/[id]/secret/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
/**
 * Client Secret 管理 API
 * POST /api/clients/[id]/secret - 重新生成 Secret
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';

/**
 * 生成 Client Secret
 */
function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * POST /api/clients/[id]/secret
 * 重新生成 Client Secret（旧的立即失效）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 检查 Client 是否存在
    const existing = await sql`
      SELECT id, name FROM clients WHERE id = ${id} OR public_id = ${id} OR client_id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const newSecret = generateClientSecret();

    // 更新 Secret
    await sql`
      UPDATE clients SET client_secret = ${newSecret}, updated_at = NOW()
      WHERE id = ${(existing[0] as any).id}
    `;

    return NextResponse.json({
      success: true,
      data: {
        clientSecret: newSecret,
      },
    });
  } catch (error) {
    console.error('[Client Secret] POST Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '重新生成 Secret 失败' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test the API endpoint**

Run: `curl -s -X POST http://localhost:4000/api/clients/portal/secret`
Expected: JSON response with new `clientSecret`

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/api/clients/[id]/secret/route.ts
git commit -m "feat(client): add POST /api/clients/[id]/secret regenerate endpoint"
```

---

### Task 5: Client Tokens API

**Files:**
- Create: `apps/portal/src/app/api/clients/[id]/tokens/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
/**
 * Client Token 管理 API
 * GET /api/clients/[id]/tokens - 获取授权 Token 列表
 * DELETE /api/clients/[id]/tokens - 撤销 Token
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/clients/[id]/tokens
 * 获取 Client 的授权 Token 列表
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const userId = searchParams.get('userId') || '';

    const offset = (page - 1) * pageSize;

    // 检查 Client 是否存在
    const clients = await sql`
      SELECT id FROM clients WHERE id = ${id} OR public_id = ${id} OR client_id = ${id}
    `;

    if (clients.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const clientId = (clients[0] as any).id;

    // 构建查询条件
    const conditions: string[] = [`client_id = '${clientId}'`];
    if (userId) {
      conditions.push(`user_id = '${userId}'`);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 查询总数
    const countResult = await sql`
      SELECT COUNT(*) as total FROM oauth_access_tokens ${sql.unsafe(whereClause)}
    `;
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 查询 Token 列表
    const tokens = await sql`
      SELECT
        t.id,
        t.user_id,
        u.email as user_email,
        u.name as user_name,
        t.scopes,
        t.created_at,
        t.expires_at
      FROM oauth_access_tokens t
      LEFT JOIN users u ON t.user_id = u.id
      ${sql.unsafe(whereClause)}
      ORDER BY t.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      data: tokens.map((t: any) => ({
        id: t.id,
        userId: t.user_id,
        userEmail: t.user_email,
        userName: t.user_name,
        scopes: t.scopes ? JSON.parse(t.scopes) : [],
        createdAt: t.created_at,
        expiresAt: t.expires_at,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[Client Tokens] GET Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取 Token 列表失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[id]/tokens
 * 撤销 Token
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { tokenIds, revokeAll } = body;

    // 检查 Client 是否存在
    const clients = await sql`
      SELECT id FROM clients WHERE id = ${id} OR public_id = ${id} OR client_id = ${id}
    `;

    if (clients.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const clientId = (clients[0] as any).id;

    if (revokeAll) {
      // 撤销所有 Token
      await sql`
        DELETE FROM oauth_access_tokens WHERE client_id = ${clientId}
      `;
    } else if (tokenIds && Array.isArray(tokenIds) && tokenIds.length > 0) {
      // 撤销指定 Token
      await sql`
        DELETE FROM oauth_access_tokens WHERE id IN ${sql(tokenIds)} AND client_id = ${clientId}
      `;
    } else {
      return NextResponse.json(
        { error: 'invalid_params', message: '请指定要撤销的 Token 或选择撤销全部' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Client Tokens] DELETE Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '撤销 Token 失败' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test the GET endpoint**

Run: `curl -s http://localhost:4000/api/clients/portal/tokens`
Expected: JSON response with tokens array

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/api/clients/[id]/tokens/route.ts
git commit -m "feat(client): add GET/DELETE /api/clients/[id]/tokens endpoints"
```

---

## Phase 2: Frontend Pages

### Task 6: Dashboard Layout Component

**Files:**
- Create: `apps/portal/src/components/layout/DashboardLayout.tsx`

- [ ] **Step 1: Create the layout component**

```typescript
/**
 * Dashboard 布局组件
 * 提供侧边栏导航和顶部栏
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  name: string;
  href: string;
  icon: string;
}

const navItems: NavItem[] = [
  { name: '首页', href: '/', icon: '🏠' },
  { name: '用户管理', href: '/users', icon: '👤' },
  { name: '部门管理', href: '/departments', icon: '🏢' },
  { name: '角色管理', href: '/roles', icon: '🔑' },
  { name: 'Client 管理', href: '/clients', icon: '📱' },
  { name: '权限管理', href: '/permissions', icon: '🛡️' },
];

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function DashboardLayout({ children, title }: DashboardLayoutProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 侧边栏 */}
      <aside className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center h-16 px-6 border-b border-gray-200">
            <span className="text-xl font-bold text-gray-900">Auth-SSO</span>
          </div>

          {/* 导航 */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors
                    ${isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                    }
                  `}
                >
                  <span className="mr-3">{item.icon}</span>
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* 底部 */}
          <div className="p-4 border-t border-gray-200">
            <Link
              href="/api/auth/logout"
              className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-50"
            >
              <span className="mr-3">🚪</span>
              退出登录
            </Link>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="pl-64">
        {/* 顶部栏 */}
        <header className="sticky top-0 z-10 flex items-center h-16 px-8 bg-white border-b border-gray-200">
          <h1 className="text-lg font-semibold text-gray-900">{title || '管理后台'}</h1>
        </header>

        {/* 页面内容 */}
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/portal/src/components/layout/DashboardLayout.tsx
git commit -m "feat(ui): add DashboardLayout component with sidebar navigation"
```

---

### Task 7: Client List Page

**Files:**
- Create: `apps/portal/src/app/clients/page.tsx`

- [ ] **Step 1: Create the page component**

```typescript
/**
 * Client 列表页
 * 显示所有 OAuth Client，支持搜索和分页
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';

interface Client {
  id: string;
  publicId: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  scopes: string;
  status: string;
  createdAt: string;
}

interface ClientsResponse {
  data: Client[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // 加载 Client 列表
  const loadClients = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        ...(keyword && { keyword }),
        ...(status && { status }),
      });
      const res = await fetch(`/api/clients?${params}`);
      const data: ClientsResponse = await res.json();
      setClients(data.data || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, [page, status]);

  // 搜索
  const handleSearch = () => {
    setPage(1);
    loadClients();
  };

  // 复制 Client ID
  const copyClientId = (clientId: string) => {
    navigator.clipboard.writeText(clientId);
    alert('已复制 Client ID');
  };

  // 删除 Client
  const deleteClient = async (id: string, name: string) => {
    if (!confirm(`确定要删除 Client "${name}" 吗？此操作不可恢复。`)) {
      return;
    }
    try {
      await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      loadClients();
    } catch (error) {
      console.error('Failed to delete client:', error);
      alert('删除失败');
    }
  };

  return (
    <DashboardLayout title="Client 管理">
      {/* 操作栏 */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="搜索名称或 Client ID"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">禁用</option>
          </select>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
          >
            搜索
          </button>
        </div>
        <Link
          href="/clients/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          新建 Client
        </Link>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">加载中...</div>
        ) : clients.length === 0 ? (
          <div className="p-8 text-center text-gray-500">暂无数据</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  名称
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Client ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  回调地址
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  创建时间
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{client.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-gray-600">{client.clientId}</code>
                      <button
                        onClick={() => copyClientId(client.clientId)}
                        className="text-gray-400 hover:text-gray-600"
                        title="复制"
                      >
                        📋
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-500 max-w-xs truncate">
                      {client.redirectUris.join(', ')}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        client.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {client.status === 'ACTIVE' ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(client.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link
                      href={`/clients/${client.publicId}`}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      编辑
                    </Link>
                    <button
                      onClick={() => deleteClient(client.publicId, client.name)}
                      className="text-red-600 hover:text-red-900"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              第 {page} 页，共 {totalPages} 页
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Test the page**

Open: `http://localhost:4000/clients`
Expected: Client list page with table, search, and pagination

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/clients/page.tsx
git commit -m "feat(client): add Client list page with search and pagination"
```

---

### Task 8: Client Detail/Edit Page

**Files:**
- Create: `apps/portal/src/app/clients/[id]/page.tsx`

- [ ] **Step 1: Create the page component**

```typescript
/**
 * Client 详情/编辑页
 * 查看、编辑 Client 信息，管理 Secret 和 Token
 */
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';

interface Client {
  id: string;
  publicId: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  scopes: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  homepageUrl: string | null;
  logoUrl: string | null;
  skipConsent: boolean;
  status: string;
  createdAt: string;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // 表单数据
  const [form, setForm] = useState({
    name: '',
    redirectUris: '',
    scopes: '',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    homepageUrl: '',
    logoUrl: '',
    skipConsent: false,
    status: 'ACTIVE',
  });

  // 加载 Client 详情
  useEffect(() => {
    const loadClient = async () => {
      try {
        const res = await fetch(`/api/clients/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setClient(data.data);
        setForm({
          name: data.data.name || '',
          redirectUris: (data.data.redirectUris || []).join('\n'),
          scopes: data.data.scopes || '',
          accessTokenTtl: data.data.accessTokenTtl || 3600,
          refreshTokenTtl: data.data.refreshTokenTtl || 604800,
          homepageUrl: data.data.homepageUrl || '',
          logoUrl: data.data.logoUrl || '',
          skipConsent: data.data.skipConsent || false,
          status: data.data.status || 'ACTIVE',
        });
      } catch (error) {
        console.error('Failed to load client:', error);
        router.push('/clients');
      } finally {
        setLoading(false);
      }
    };
    loadClient();
  }, [id, router]);

  // 保存
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          redirectUris: form.redirectUris.split('\n').filter(Boolean),
          scopes: form.scopes,
          accessTokenTtl: form.accessTokenTtl,
          refreshTokenTtl: form.refreshTokenTtl,
          homepageUrl: form.homepageUrl || null,
          logoUrl: form.logoUrl || null,
          skipConsent: form.skipConsent,
          status: form.status,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      alert('保存成功');
      router.refresh();
    } catch (error) {
      console.error('Failed to save:', error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 重新生成 Secret
  const regenerateSecret = async () => {
    if (!confirm('重新生成 Secret 后，旧的 Secret 将立即失效。确定继续吗？')) {
      return;
    }
    try {
      const res = await fetch(`/api/clients/${id}/secret`, { method: 'POST' });
      const data = await res.json();
      setNewSecret(data.data.clientSecret);
      setShowSecret(true);
      alert('Secret 已重新生成，请立即保存！');
    } catch (error) {
      console.error('Failed to regenerate secret:', error);
      alert('操作失败');
    }
  };

  // 删除
  const handleDelete = async () => {
    if (!confirm('确定要删除此 Client 吗？此操作不可恢复。')) {
      return;
    }
    try {
      await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      router.push('/clients');
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('删除失败');
    }
  };

  if (loading) {
    return (
      <DashboardLayout title="Client 详情">
        <div className="p-8 text-center text-gray-500">加载中...</div>
      </DashboardLayout>
    );
  }

  if (!client) {
    return (
      <DashboardLayout title="Client 详情">
        <div className="p-8 text-center text-gray-500">Client 不存在</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={`Client: ${client.name}`}>
      <div className="max-w-4xl">
        {/* 基本信息 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">基本信息</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                名称
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client ID
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-100 rounded-md text-sm">
                  {client.clientId}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(client.clientId)}
                  className="px-3 py-2 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  📋
                </button>
              </div>
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client Secret
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-100 rounded-md text-sm">
                  {newSecret || '••••••••••••••••••••••••••••••••'}
                </code>
                <button
                  onClick={regenerateSecret}
                  className="px-3 py-2 bg-yellow-100 text-yellow-800 rounded-md hover:bg-yellow-200"
                >
                  重新生成
                </button>
              </div>
              {newSecret && (
                <p className="mt-1 text-sm text-red-600">
                  请立即保存新的 Secret，此内容仅显示一次！
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                主页 URL
              </label>
              <input
                type="text"
                value={form.homepageUrl}
                onChange={(e) => setForm({ ...form, homepageUrl: e.target.value })}
                placeholder="https://example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Logo URL
              </label>
              <input
                type="text"
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                placeholder="https://example.com/logo.png"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* OAuth 配置 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">OAuth 配置</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                回调地址（每行一个）
              </label>
              <textarea
                value={form.redirectUris}
                onChange={(e) => setForm({ ...form, redirectUris: e.target.value })}
                rows={3}
                placeholder="http://localhost:3000/callback"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                支持的 Scope（空格分隔）
              </label>
              <input
                type="text"
                value={form.scopes}
                onChange={(e) => setForm({ ...form, scopes: e.target.value })}
                placeholder="openid profile email"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Access Token 有效期（秒）
                </label>
                <input
                  type="number"
                  value={form.accessTokenTtl}
                  onChange={(e) => setForm({ ...form, accessTokenTtl: parseInt(e.target.value) || 3600 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Refresh Token 有效期（秒）
                </label>
                <input
                  type="number"
                  value={form.refreshTokenTtl}
                  onChange={(e) => setForm({ ...form, refreshTokenTtl: parseInt(e.target.value) || 604800 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="skipConsent"
                checked={form.skipConsent}
                onChange={(e) => setForm({ ...form, skipConsent: e.target.checked })}
                className="h-4 w-4 text-blue-600 rounded"
              />
              <label htmlFor="skipConsent" className="text-sm text-gray-700">
                跳过授权确认页
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                状态
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ACTIVE">启用</option>
                <option value="DISABLED">禁用</option>
              </select>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
          >
            删除
          </button>
          <button
            onClick={() => router.push('/clients')}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
          >
            返回
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Test the page**

Open: `http://localhost:4000/clients/portal` (or any existing client ID)
Expected: Client detail page with edit form

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/app/clients/[id]/page.tsx
git commit -m "feat(client): add Client detail/edit page"
```

---

## Phase 3: Final Testing

### Task 9: End-to-End Testing

- [ ] **Step 1: Test complete Client CRUD flow**

1. Navigate to `http://localhost:4000/clients`
2. Click "新建 Client"
3. Fill in name and redirect URIs
4. Save and verify client_secret is shown
5. Edit the client
6. Regenerate secret
7. Delete the client

- [ ] **Step 2: Update design doc with completion status**

Mark all checkboxes in `docs/superpowers/specs/2026-03-30-client-management-design.md` as completed.

- [ ] **Step 3: Final commit**

```bash
git add docs/superpowers/specs/2026-03-30-client-management-design.md
git commit -m "docs(client): mark M4 Client management as completed"
```

---

## Summary

**Files Created:**
- `apps/portal/src/app/api/clients/route.ts`
- `apps/portal/src/app/api/clients/[id]/route.ts`
- `apps/portal/src/app/api/clients/[id]/secret/route.ts`
- `apps/portal/src/app/api/clients/[id]/tokens/route.ts`
- `apps/portal/src/components/layout/DashboardLayout.tsx`
- `apps/portal/src/app/clients/page.tsx`
- `apps/portal/src/app/clients/[id]/page.tsx`

**Total Tasks:** 9
**Estimated Time:** 2-3 hours
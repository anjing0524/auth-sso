# M4 Client 管理模块设计文档

- 版本: v1.0
- 日期: 2026-03-30
- 里程碑: M4 权限中心

---

## 1. 概述

### 1.1 目标

实现 OAuth Client 的完整管理能力，包括：
- Client CRUD（创建、读取、更新、删除）
- Client Secret 管理（生成、轮换）
- 授权 Token 管理（查看、撤销）
- Scope 和 Token TTL 配置

### 1.2 范围

- **后端 API**: Portal BFF 提供 Client 管理接口
- **前端页面**: Client 列表页、详情/编辑页
- **权限控制**: 基于权限码的访问控制

### 1.3 技术栈

- 后端: Next.js API Routes + Drizzle ORM
- 前端: Next.js App Router + React + Tailwind CSS
- 数据库: PostgreSQL（Schema 已存在）

---

## 2. 后端 API 设计

### 2.1 路由结构

```
/api/clients
├── route.ts              # GET(列表) / POST(创建)
└── [id]/
    ├── route.ts          # GET(详情) / PUT(更新) / DELETE(删除)
    ├── secret/route.ts   # POST(生成新Secret)
    └── tokens/route.ts   # GET(授权Token列表) / DELETE(撤销)
```

### 2.2 接口详情

#### GET /api/clients - 获取 Client 列表

**Query 参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页数量，默认 20 |
| keyword | string | 否 | 搜索关键词（名称、Client ID） |
| status | string | 否 | 状态筛选：ACTIVE / DISABLED |

**响应:**
```json
{
  "data": [
    {
      "id": "uuid",
      "publicId": "client_xxx",
      "name": "Portal",
      "clientId": "portal",
      "redirectUris": ["http://localhost:4000/api/auth/callback"],
      "status": "ACTIVE",
      "createdAt": "2026-03-30T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 10,
    "totalPages": 1
  }
}
```

#### POST /api/clients - 创建 Client

**请求体:**
```json
{
  "name": "新应用",
  "redirectUris": ["http://localhost:3000/callback"],
  "scopes": "openid profile email",
  "accessTokenTtl": 3600,
  "refreshTokenTtl": 604800,
  "homepageUrl": "http://localhost:3000",
  "logoUrl": null,
  "skipConsent": false
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "publicId": "client_xxx",
    "clientId": "generated_client_id",
    "clientSecret": "generated_secret_show_once",
    "name": "新应用",
    ...
  }
}
```

**注意:** `clientSecret` 仅在创建时返回一次，后续不可查看。

#### GET /api/clients/[id] - 获取 Client 详情

**响应:** 包含完整 Client 信息（不含 clientSecret）

#### PUT /api/clients/[id] - 更新 Client

**请求体:** 可更新字段同创建，不含 clientId 和 clientSecret

#### DELETE /api/clients/[id] - 删除 Client

软删除或硬删除（根据业务需求决定），建议改为状态切换（DISABLED）

#### POST /api/clients/[id]/secret - 重新生成 Secret

**响应:**
```json
{
  "success": true,
  "data": {
    "clientSecret": "new_generated_secret_show_once"
  }
}
```

**行为:** 生成新的 clientSecret，旧的立即失效。

#### GET /api/clients/[id]/tokens - 获取授权 Token 列表

**Query 参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码 |
| pageSize | number | 否 | 每页数量 |
| userId | string | 否 | 按用户筛选 |

**响应:**
```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "user_uuid",
      "username": "admin@example.com",
      "scopes": ["openid", "profile"],
      "createdAt": "2026-03-30T00:00:00Z",
      "expiresAt": "2026-03-30T01:00:00Z",
      "revoked": false
    }
  ],
  "pagination": {...}
}
```

#### DELETE /api/clients/[id]/tokens - 撤销 Token

**请求体:**
```json
{
  "tokenIds": ["uuid1", "uuid2"],  // 指定 Token ID
  "revokeAll": false               // 或撤销所有
}
```

---

## 3. 前端页面设计

### 3.1 页面路由

```
/clients           -> Client 列表页
/clients/new       -> 新建 Client 页
/clients/[id]      -> Client 详情/编辑页
```

### 3.2 列表页

**组件:**
- 搜索框 + 状态筛选下拉
- 数据表格（名称、Client ID、状态、创建时间、操作）
- 分页组件
- 新建按钮

**操作:**
- 复制 Client ID
- 编辑
- 禁用/启用
- 删除（需确认）

### 3.3 详情/编辑页

**分区:**

1. **基本信息**
   - 名称、主页 URL、Logo URL

2. **OAuth 配置**
   - Client ID（只读，可复制）
   - Client Secret（隐藏，可显示/重新生成）
   - 回调地址列表
   - 支持的 Scope
   - Access Token TTL
   - Refresh Token TTL
   - 是否跳过授权确认

3. **授权记录**
   - Token 列表表格
   - 撤销操作

4. **状态管理**
   - 启用/禁用开关
   - 删除按钮

---

## 4. 数据模型

### 4.1 clients 表（已存在）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text | UUID 主键 |
| public_id | text | 对外展示 ID |
| name | text | Client 名称 |
| client_id | text | OAuth client_id（唯一） |
| client_secret | text | OAuth client_secret |
| redirect_uris | text | JSON 数组，回调地址 |
| grant_types | text | JSON 数组，授权类型 |
| scopes | text | 空格分隔的 scope 列表 |
| homepage_url | text | 应用主页 |
| logo_url | text | 应用 Logo |
| access_token_ttl | integer | Access Token 有效期(秒) |
| refresh_token_ttl | integer | Refresh Token 有效期(秒) |
| status | enum | ACTIVE / DISABLED |
| disabled | boolean | Better Auth 兼容字段 |
| skip_consent | boolean | 是否跳过授权确认 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### 4.2 oauth_access_tokens 表（已存在）

用于查询授权记录。

---

## 5. 权限码定义

| 权限码 | 说明 | 对应操作 |
|--------|------|----------|
| `client:list` | 查看 Client 列表 | GET /api/clients |
| `client:create` | 创建 Client | POST /api/clients |
| `client:read` | 查看 Client 详情 | GET /api/clients/[id] |
| `client:update` | 更新 Client | PUT /api/clients/[id] |
| `client:delete` | 删除/禁用 Client | DELETE /api/clients/[id] |
| `client:secret` | 管理 Client Secret | POST /api/clients/[id]/secret |
| `client:token` | 查看/撤销授权 Token | GET/DELETE /api/clients/[id]/tokens |

---

## 6. 安全考虑

### 6.1 Secret 管理

- Secret 仅在创建和重新生成时返回一次
- Secret 不记录日志
- 重新生成 Secret 立即生效，旧 Secret 立即失效

### 6.2 权限校验

- 所有 API 需校验用户登录态
- 所有 API 需校验对应权限码
- 敏感操作（Secret 生成、Token 撤销）需额外确认

### 6.3 数据校验

- redirect_uri 必须是有效 URL
- redirect_uri 必须在白名单域名下（可配置）
- Scope 必须是系统支持的 scope 子集

---

## 7. 实现计划

### Phase 1: 后端 API

1. 实现 `/api/clients` 列表和创建
2. 实现 `/api/clients/[id]` 详情、更新、删除
3. 实现 `/api/clients/[id]/secret` Secret 管理
4. 实现 `/api/clients/[id]/tokens` Token 管理
5. 添加权限中间件

### Phase 2: 前端页面

1. 实现 Client 列表页
2. 实现 Client 详情/编辑页
3. 集成权限控制

### Phase 3: 测试与完善

1. 编写 API 测试
2. 端到端测试
3. 文档更新

---

## 8. 验收标准

- [ ] 管理员可创建、查看、编辑、删除 Client
- [ ] Client Secret 仅显示一次，可重新生成
- [ ] 可查看和撤销授权 Token
- [ ] 无权限用户无法访问管理接口
- [ ] 前端页面功能完整、交互流畅
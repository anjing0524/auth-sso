# Portal 架构设计与开发规范指南 (BFF 双控制器 + 函数式 DDD + TDD)

本指南旨在规范 `@auth-sso/portal` 项目在现代 Next.js App Router 架构下的设计与重构标准，并完全对齐 [@portal-ddd-architecture-requirements.md](file:///Users/liushuo/code/干了科技/auth-sso/docs/brainstorms/portal-ddd-architecture-requirements.md) 需求文档。

---

## 一、 系统拓扑与双控制器 (Double Controller) 架构

为了实现大前端架构下的**“防腐”**与**“平滑迁移能力”**，我们推行 **BFF 双控制器 (Double Controller)** 开发心智，彻底将业务逻辑与框架层和接口协议剥离：

```mermaid
flowchart TD
    subgraph "1. 展现层 (Presentation - Browser)"
        UI["React Client Components (Table / Drawer Form)"]
    end

    subgraph "2. 双控制器层 (Double Controller - BFF Side)"
        Action["Server Actions<br/>(浏览器侧 Controller: 只做 DTO 转换 + revalidatePath)"]
        REST["REST Route Handlers (/api/*)<br/>(网关/程序化侧 Controller: 返回 JSON)"]
    end

    subgraph "3. 纯净领域层 (Domain Layer - 100% Pure TS & TDD)"
        domain["限界上下文 (domain/user/, domain/role/)<br/>- Branded Types (Id 烙印类型)<br/>- 纯函数 (校验/核心状态机)"
        Repo["Repository 仓储接口定义"]
    end

    subgraph "4. 基础设施层 (Infrastructure - 技术细节)"
        DrizzleRepo["DrizzleRepository (本地 ORM 实现)"]
        HttpRepo["HttpRepository (远端微服务 Fetch 实现)"]
    end

    %% 展示层交互
    UI -->|1. onSubmit 表单提交| Action
    UI -.->|1. 程序化调用 /api/| REST

    %% 控制器分发
    Action -->|2. 鉴权 & 传参| domain
    REST -->|2. 鉴权 & 传参| domain
    
    %% 领域编排
    domain -->|3. 核心规则计算| Repo
    Repo -.->|4. 契约注入| DrizzleRepo
    Repo -.->|4. 契约注入| HttpRepo
```

### 核心分层职责：
1.  **读模型 (Read Model)**：Page 路由 (Server Component) 提取 URL `searchParams`，在数据拉取辅助器（`data.ts`）中直接通过 Drizzle SQL / API 获取扁平的数据对象，同步直传渲染，不经过 Domain 层包装，追求极致性能。
2.  **写模型 (Write Model - 双控制器)**：
    *   **REST Route Handlers**（`api/*/route.ts`）：作为面向网关、程序化脚本、外部客户端的标准 HTTP REST API，解析 JSON，调用领域层并返回 JSON 响应。
    *   **Server Actions**（`_actions.ts`）：作为面向浏览器页面表单交互的薄 Controller，解析 FormData，调用领域层，执行 `revalidatePath` 刷新缓存并返回 `{ success, message }`。
    *   **统一规范**：所有控制层函数体**不超过 20 行，严禁内联 SQL 或任何核心业务校验**。
3.  **领域层 (Domain Layer)**：纯原生 TS 代码，零依赖 Next.js 模块。使用 Branded Types 定义强类型标识符，将所有核心业务规则抽象为**纯函数**。
4.  **基础设施层 (Infrastructure Layer)**：实现领域仓储接口。如果将来后台语言由 Node.js 改为 Go/Java 独立微服务，只需编写 `HttpRepository` 覆盖替换，整个展示层和领域层 100% 零改动。

---

## 二、 物理目录结构规范 (R5, R6)

重构与新建限界上下文 (Bounded Contexts) 时，应当严格按照以下路径划分职责：

```
src/
├── app/users/                  # 1. 展现层 (与 Next.js 强相关)
│   ├── page.tsx                #   - 路由直出入口 (Server Component 读模型)
│   ├── data.ts                 #   - 读模型数据拉取辅助器 (直接 Drizzle 连库)
│   ├── _actions.ts             #   - BFF 控制器：浏览器侧 Server Actions
│   └── components/             #   - 局部 UI 组件 (UserTable, CreateUserDrawer)
│
├── domain/                     # 2. 纯净领域层 (零依赖 Next.js)
│   └── user/                   #   - 聚合根 BC 有界上下文
│       ├── types.ts            #     * Branded Types (烙印类型) + Zod 运行时验证
│       ├── user.ts             #     * 聚合根实体与核心领域纯函数
│       └── repository.ts       #     * 仓储接口定义 (Repository Interface)
│
└── infrastructure/             # 3. 基础设施层 (具体技术实现)
    ├── persistence/            #   - 持久化实现 (DrizzleUserRepositoryImpl)
    └── auth/                   #   - 鉴权适配器 (Better Auth & JWT 适配)
```

---

## 三、 核心代码落地样例规范

### 3.1 领域层：Branded Types 与实体纯函数 (domain/user/)

```typescript
// domain/user/types.ts
import { z } from 'zod';

// Branded Types 定义，编译期绝对安全
export type UserId = string & { readonly __brand: unique symbol };
export const toUserId = (id: string) => id as UserId;

export const UserSchema = z.object({
  id: z.string().transform(toUserId),
  username: z.string().min(3, '用户名至少3位'),
  email: z.string().email('邮箱格式不合法'),
  status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED', 'DELETED'])
});

export type UserProps = z.infer<typeof UserSchema>;

// domain/user/user.ts
import { UserProps } from './types';

/**
 * 核心领域纯函数：状态切换规则
 */
export function toggleUserStatus(user: UserProps): UserProps {
  if (user.status === 'DELETED') {
    throw new Error('已逻辑删除的用户无法操作状态');
  }
  const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  return { ...user, status: newStatus };
}
```

### 3.2 表现层：薄 Controller 规范 (actions.ts / route.ts)

所有的 Controller 均需调用同一个领域层逻辑，保证写模型的一致性：

```typescript
// app/users/_actions.ts (浏览器侧 Server Actions Controller)
'use server';

import { revalidatePath } from 'next/cache';
import { checkPermission } from '@/lib/auth-middleware';
import { DrizzleUserRepository } from '@/infrastructure/persistence/drizzle-user-repo';
import { createUser } from '@/domain/user/user';

export async function createUserAction(prevState: any, formData: FormData) {
  // 1. BFF 鉴权
  const check = await checkPermission(undefined, { permissions: ['user:create'] });
  if (!check.authorized) return { success: false, message: '权限不足' };

  try {
    // 2. DTO 参数提取并转换
    const input = Object.fromEntries(formData);
    const repo = new DrizzleUserRepository();
    
    // 3. 编排调用领域实体逻辑并持久化
    await repo.create(createUser(input));
    
    // 4. 刷新缓存并返回
    revalidatePath('/users');
    return { success: true, message: '创建成功' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}
```

---

## 四、 单元测试与 TDD (R12)

我们只在不依赖任何框架的 `domain/` 下高频推行 TDD：

```typescript
// __tests__/domain/user.test.ts
import { describe, it, expect } from 'vitest';
import { toggleUserStatus } from '@/domain/user/user';
import { toUserId } from '@/domain/user/types';

describe('User 领域核心规则 TDD 测试', () => {
  it('当激活态用户切换状态时，应变为禁用状态', () => {
    const user = { id: toUserId('u_1'), username: 'test', email: 'a@a.com', status: 'ACTIVE' as const };
    const updated = toggleUserStatus(user);
    expect(updated.status).toBe('DISABLED');
  });

  it('当删除态用户切换状态时，应抛出异常拦截', () => {
    const user = { id: toUserId('u_1'), username: 'test', email: 'a@a.com', status: 'DELETED' as const };
    expect(() => toggleUserStatus(user)).toThrow('已逻辑删除的用户无法操作状态');
  });
});
```

---

## 五、 命名与物理边界约束表 (R5, R9)

| 文件类别 | 物理命名格式 | 允许导入的依赖 | 职责限制 |
| :--- | :--- | :--- | :--- |
| **首屏拉取** | `page.tsx` | 展示子组件, `data.ts` | 读模型入口，严禁进行写操作变更 |
| **查询辅助** | `data.ts` | `drizzle-orm`, `next/headers` | 绕过领域层直接获取扁平只读数据 |
| **Server Action**| `_actions.ts` | `next/cache`, `domain/`, `infrastructure/`| 浏览器写网关。**不得超过 20 行**，严禁内联 SQL |
| **API 路由** | `route.ts` | `next/server`, `domain/`, `infrastructure/` | 网关 REST 写网关。同上约束，负责返回 JSON 响应 |
| **领域层核心** | `domain/*/*.ts` | **仅限纯原生 TypeScript / Zod** | 承载纯净的领域逻辑、值对象和 Zod schema |
| **仓储契约** | `domain/*/repository.ts`| 仅限领域模型类型定义 | 描述数据契约接口，不涉及具体数据库实现 |
| **持久化仓储** | `infrastructure/persistence/*`| `drizzle-orm` / `fetch` (微服务) | Repository 的具体实现，进行 DTO ↔ Entity 映射 |

# Auth-SSO 设计系统

版本: v2.0
最后更新: 2026-03-24

---

## 概述

本文档定义 Auth-SSO 产品的视觉设计规范，确保跨页面的一致性和品牌识别度。

**设计原则:**
1. **专业可信**: 深蓝色主色调传达安全和专业
2. **现代精致**: Geist 字体 + 克制动效，摆脱"AI 生成感"
3. **数据优先**: 管理后台突出数据密度和操作效率
4. **中文优化**: 字体选择优先中文显示效果
5. **极简登录**: 登录页减少视觉元素，专注核心操作

---

## 颜色系统

### 主色调 (Primary)

| 名称 | Hex 值 | 用途 |
|------|--------|------|
| primary-50 | #E6F0FF | 浅背景、悬停态 |
| primary-100 | #CCE0FF | 禁用背景 |
| primary-200 | #99C2FF | - |
| primary-300 | #66A3FF | - |
| primary-400 | #3385FF | - |
| primary-500 | #0066FF | 主品牌色 |
| primary-600 | #0052CC | 悬停态 |
| primary-700 | #003D99 | 激活态 |
| primary-800 | #002966 | - |
| primary-900 | #001433 | - |

### 中性色 (Neutral)

| 名称 | Hex 值 | 用途 |
|------|--------|------|
| gray-50 | #FAFBFC | 背景底色 |
| gray-100 | #F1F5F9 | 卡片背景 |
| gray-200 | #E2E8F0 | 边框 |
| gray-300 | #CBD5E1 | - |
| gray-400 | #94A3B8 | 禁用文字 |
| gray-500 | #64748B | 次要文字 |
| gray-600 | #475569 | - |
| gray-700 | #334155 | 正文 |
| gray-800 | #1E293B | - |
| gray-900 | #0F172A | 标题 |

### 语义色 (Semantic)

| 名称 | Hex 值 | 用途 |
|------|--------|------|
| success | #10B981 | 成功状态 |
| warning | #F59E0B | 警告状态 |
| error | #EF4444 | 错误状态 |
| info | #3B82F6 | 信息状态 |

### CSS 变量 (浅色模式)

```css
:root {
  /* 主色 */
  --color-primary: #0066FF;
  --color-primary-hover: #0052CC;
  --color-primary-subtle: #E6F0FF;

  /* 背景 */
  --color-background: #FAFBFC;
  --color-surface: #FFFFFF;
  --color-surface-elevated: #FFFFFF;

  /* 文字 */
  --color-text-primary: #0F172A;
  --color-text-secondary: #475569;
  --color-text-muted: #94A3B8;

  /* 边框 */
  --color-border: #E2E8F0;

  /* 语义 */
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-info: #3B82F6;

  /* 品牌渐变 (登录页背景) */
  --color-gradient-start: #0066FF;
  --color-gradient-end: #003399;
}
```

### CSS 变量 (暗黑模式)

```css
.dark {
  --color-background: #0F172A;
  --color-surface: #1E293B;
  --color-surface-elevated: #334155;
  --color-text-primary: #F1F5F9;
  --color-text-secondary: #94A3B8;
  --color-text-muted: #64748B;
  --color-primary: #3B82F6;
  --color-border: #334155;
}
```

---

## 字体规范

### 字体家族

| 类型 | 字体 | 说明 |
|------|------|------|
| 中文 | "PingFang SC", "Microsoft YaHei", sans-serif | 中文显示优先 |
| 英文 | "Geist", -apple-system, BlinkMacSystemFont, sans-serif | 现代科技感 |
| 等宽 | "JetBrains Mono", "Fira Code", monospace | 数据、代码 |

**字体加载 (Google Fonts):**

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 字号规范 (更新)

| 名称 | 字号 | 行高 | 用途 |
|------|------|------|------|
| xs | 12px | 16px | 辅助文字、标签 |
| sm | 13px | 20px | 表格、列表项 — 更紧凑 |
| base | 15px | 24px | 正文 — 比 16px 更现代 |
| lg | 17px | 28px | 副标题 |
| xl | 21px | 28px | 卡片标题 |
| 2xl | 27px | 36px | 页面标题 |
| 3xl | 35px | 40px | 大标题 |
| 4xl | 45px | 52px | 登录页品牌名 |

### 字重规范

| 名称 | 值 | 用途 |
|------|-----|------|
| regular | 400 | 正文 |
| medium | 500 | 表格标题、按钮 |
| semibold | 600 | 卡片标题、导航 |
| bold | 700 | 页面标题、品牌名 |

---

## 间距系统

### 基础间距 (基于 4px)

| 名称 | 值 | 用途 |
|------|-----|------|
| 0 | 0px | - |
| 1 | 4px | 紧凑元素间距 |
| 2 | 8px | 图标与文字间距 |
| 3 | 12px | 列表项内间距 |
| 4 | 16px | 卡片内间距、表单字段间距 |
| 5 | 20px | 卡片间距 |
| 6 | 24px | 区块间距 |
| 8 | 32px | 页面区块间距 |
| 10 | 40px | 页面内边距 |
| 12 | 48px | 页面顶部间距 |
| 16 | 64px | 页面底部间距 |

### 布局规范

| 元素 | 值 |
|------|-----|
| 页面内边距 | 24px (移动端) / 40px (桌面) |
| 卡片内边距 | 24px |
| 卡片间距 | 24px |
| 表单字段间距 | 16px |
| 按钮间距 | 12px (组内) / 24px (组间) |
| 导航高度 | 64px (顶部) / 240px (侧边栏展开) |
| 最大内容宽度 | 1440px (管理后台) / 400px (登录页) |

---

## 圆角系统

采用分层圆角，避免视觉单调：

| 名称 | 值 | 用途 |
|------|-----|------|
| sm | 6px | 标签、小按钮 |
| md | 8px | 按钮、输入框 |
| lg | 12px | 卡片、面板 |
| full | 9999px | 徽章、头像 |

---

## 动效系统

### 动效原则

- **克制功能性**: 动效服务于理解，不为装饰而动
- **快速响应**: 用户操作立即得到视觉反馈
- **自然流畅**: 使用合适的缓动曲线

### 缓动曲线

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* 进入动画 */
--ease-in: cubic-bezier(0.7, 0, 0.84, 0);        /* 退出动画 */
--ease-in-out: cubic-bezier(0.87, 0, 0.13, 1);   /* 移动动画 */
```

### 持续时间

| 名称 | 值 | 用途 |
|------|-----|------|
| fast | 100ms | 按钮悬停、开关切换 |
| normal | 200ms | 下拉菜单、面板展开 |
| slow | 300ms | 页面过渡、模态框 |

### 应用场景

| 场景 | 动效 | 持续时间 |
|------|------|----------|
| 按钮悬停 | 背景色渐变 | 100ms |
| 输入框聚焦 | 边框颜色 + 外发光 | 100ms |
| 下拉菜单 | 高度展开 | 200ms ease-out |
| 模态框 | 淡入 + 轻微上移 | 200ms |
| Toast 通知 | 从右侧滑入 | 300ms |
| 卡片悬停 | 上移 4px + 阴影 | 200ms ease-out |

---

## 组件规范

### 按钮

**尺寸:**

| 名称 | 高度 | 水平内边距 | 字号 |
|------|------|-----------|------|
| sm | 32px | 12px | 14px |
| md | 40px | 16px | 14px |
| lg | 48px | 24px | 16px |

**变体:**

| 名称 | 样式 | 用途 |
|------|------|------|
| primary | 主色背景 + 白色文字 | 主要操作 |
| secondary | 透明背景 + 主色边框 + 主色文字 | 次要操作 |
| ghost | 透明背景 + 次要文字 | 辅助操作 |
| danger | 红色背景 + 白色文字 | 危险操作 |

**圆角:** 8px (默认) / 6px (紧凑)

**悬停态:**
- Primary: 背景色加深 (--color-primary-hover)
- Secondary: 背景色填充 (--color-primary-subtle)
- Ghost: 背景色填充 (--color-surface-elevated)

### 输入框

| 属性 | 值 |
|------|-----|
| 默认高度 | 40px |
| 登录页高度 | 48px |
| 圆角 | 8px |
| 内边距 | 12px 16px |

**状态:**

| 状态 | 边框颜色 | 背景 |
|------|---------|------|
| default | #E2E8F0 | #FAFBFC |
| focus | #0066FF + 外发光 | #FFFFFF |
| error | #EF4444 | #FEF2F2 |
| disabled | #E2E8F0 | #F1F5F9 |

**聚焦外发光:**

```css
box-shadow: 0 0 0 3px var(--color-primary-subtle);
```

### 卡片

| 属性 | 值 |
|------|-----|
| 背景 | var(--color-surface) |
| 边框 | 1px solid var(--color-border) |
| 圆角 | 12px |
| 阴影 | 无 (扁平设计) |
| 内边距 | 24px |

**悬停态 (可选):**

```css
transform: translateY(-4px);
box-shadow: 0 12px 24px -8px rgba(0, 102, 255, 0.15);
```

### 提示信息 (Alert)

| 类型 | 背景 | 文字 |
|------|------|------|
| success | #D1FAE5 | #065F46 |
| warning | #FEF3C7 | #92400E |
| error | #FEE2E2 | #991B1B |
| info | #DBEAFE | #1E40AF |

**样式:**
- 内边距: 12px 16px
- 圆角: 8px
- 字号: 14px

### 状态徽章 (Badge)

| 类型 | 背景 | 文字 |
|------|------|------|
| active | #D1FAE5 | #059669 |
| disabled | #FEE2E2 | #DC2626 |
| pending | #FEF3C7 | #D97706 |

**样式:**
- 内边距: 4px 10px
- 圆角: full (9999px)
- 字号: 11px
- 字重: 500

---

## 页面布局

### 登录页

```
┌─────────────────────────────────────────────┐
│                                             │
│         渐变背景 (#0066FF → #003399)         │
│                                             │
│     ┌─────────────────────────┐             │
│     │                         │             │
│     │       Auth-SSO          │  ← 品牌名   │
│     │   企业统一身份认证平台    │  ← 副标题  │
│     │                         │             │
│     │   ┌─────────────────┐   │             │
│     │   │ 用户名          │   │  ← 输入框  │
│     │   └─────────────────┘   │             │
│     │   ┌─────────────────┐   │             │
│     │   │ 密码            │   │             │
│     │   └─────────────────┘   │             │
│     │                         │             │
│     │   ┌─────────────────┐   │             │
│     │   │      登录       │   │  ← 主按钮  │
│     │   └─────────────────┘   │             │
│     │                         │             │
│     └─────────────────────────┘             │
│              白色卡片，阴影                   │
│                                             │
└─────────────────────────────────────────────┘
```

- 垂直居中布局
- 最大宽度 380px
- 白色卡片 + 柔和阴影
- 渐变背景增加品牌感

### 管理后台

```
┌─────────────────────────────────────────────────────────┐
│ 顶部导航 (64px)                                          │
├──────────┬──────────────────────────────────────────────┤
│          │ 面包屑 > 页面标题              [操作按钮]     │
│ 侧边栏   ├──────────────────────────────────────────────┤
│ (240px)  │                                              │
│          │  ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│ ▸ 工作台 │  │ 用户总数  │ │ 今日登录  │ │ 活跃应用  │      │
│   用户   │  │   1,234  │ │    856   │ │    12    │      │
│   部门   │  └──────────┘ └──────────┘ └──────────┘      │
│   角色   │                                              │
│   应用   │  ┌─────────────────────────────────────┐     │
│   日志   │  │ 表格数据...                          │     │
│          │  │                                      │     │
│          │  └─────────────────────────────────────┘     │
└──────────┴──────────────────────────────────────────────┘
```

- 顶部导航 (64px) + 侧边栏 (240px 可折叠) + 工作区
- 工作区最大宽度 1440px
- 数据密度优先

---

## 反 AI 模板规则

### 禁止使用的模式

| 模式 | 问题 | 替代方案 |
|------|------|---------|
| 紫色渐变背景 | 千篇一律的 SaaS 风格 | 品牌主色调渐变或纯色 |
| 3列特性卡片+图标 | 典型 AI 生成布局 | 功能导向的信息架构 |
| 居中对称布局 | 缺乏层次感 | 左右不对称布局突出重点 |
| 统一大圆角 | 视觉单调 | 分层圆角 (sm/md/lg) |
| 装饰性浮动元素 | 无意义的视觉噪音 | 功能性装饰 |
| emoji 作为设计元素 | 不够专业 | 图标库或自定义图标 |
| Inter 字体 | 滥用导致缺乏辨识度 | Geist / Satoshi 等现代字体 |
| 渐变按钮 | 过度装饰 | 纯色按钮 + 悬停变化 |

---

## 技术架构与核心安全设计

### 1. OIDC 强拦截与状态双重防卫机制

在 Auth-SSO 系统中，为了防范“账户中途被停用/锁定，但仍可利用旧会话进入子系统”以及“普通用户越权访问未授权子应用”的经典安全漏洞，IdP 在授权码发放阶段实施了双重强拦截防卫：
- **实时状态核准**：每次 OAuth 授权请求均会实时穿透查询数据库中用户的最新状态（Active/Disabled/Locked），对非 Active 状态进行强行阻断。
- **动态应用准入**：除超级管理员（SUPER_ADMIN）外，普通用户必须绑定了包含目标客户端的角色关系，否则拒绝准入并重定向至未授权错误页。

```mermaid
sequenceDiagram
    autonumber
    actor Browser as 浏览器
    participant Portal as 门户 (BFF)
    participant Portal as Portal (Better Auth OIDC Provider)
    participant DB as PostgreSQL 数据库

    Browser->>Portal: 1. 访问子应用 -> 重定向到 IdP /oauth2/authorize
    Note over Browser,Portal: 浏览器自动携带 idp_session Cookie
    activate Portal
    Portal->>DB: 2. 检查 OAuth 客户端状态 (ACTIVE/disabled)
    DB-->>Portal: 客户端状态有效
    Portal->>DB: 3. 查询当前登录用户的最新状态 (schema.users.status)
    DB-->>Portal: 返回状态 (例如：LOCKED 锁定)
    alt 账号状态非 ACTIVE 或被停用
        Portal-->>Browser: 4a. 强行阻断！重定向到 /error?error=user_inactive
    else 账号状态正常 (ACTIVE)
        Portal->>DB: 5. 获取用户拥有的角色，并过滤非 ACTIVE 角色
        DB-->>Portal: 返回活跃角色列表
        alt 角色为管理员 (ADMIN / SUPER_ADMIN)
            Portal-->>Browser: 6a. 绕过授权关系校验，发放授权码
        else 普通用户角色
            Portal->>DB: 7. 检查角色客户端关联 (role_clients)
            DB-->>Portal: 检查无绑定关系
            alt 未授权
                Portal-->>Browser: 8a. 强行拦截！重定向到 /error?error=unauthorized_client
            else 已授权
                Portal-->>Browser: 8b. 静默跳过同意页 (skipConsent) -> 返回 auth_code
            end
        end
    end
    deactivate Portal
```

### 2. 数据沙箱部门级联与 CTE 递归防死循环

为了支撑精细化数据隔离需求（`ALL` / `DEPT` / `DEPT_AND_SUB` / `SELF` / `CUSTOM`），系统在底层 ORM 执行 SQL 时强制通过中间件注入沙箱判定。
在 `DEPT_AND_SUB` （本部门及子部门）的层级检索中，采用 PostgreSQL 的 `WITH RECURSIVE` 递归查询，并引入了“双重安全防爆与 Fail-Safe 降级”策略，从根源上杜绝因脏数据导致无限递归拖垮数据库的隐患（Infinite Loop DoS）：

```mermaid
graph TD
    A[调用 checkDataScope] --> B{角色 DataScopeType?}
    B -->|ALL| C[直接返回 true - 允许访问]
    B -->|SELF / DEPT| D[校验 context.deptId === targetDeptId]
    B -->|CUSTOM| E[查询 role_data_scopes 是否存在绑定关系]
    B -->|DEPT_AND_SUB| F[执行 WITH RECURSIVE SQL 递归查询]
    F --> G{层级深度 depth < 10 ?}
    G -->|Yes| H[向上继续查找父子关系]
    G -->|No| I[触发防爆截断 - 拦截循环递归]
    H --> J{找到匹配?}
    J -->|Yes| K[返回 true]
    J -->|No| L[返回 false]
    I --> M[Fail-Safe 回退模式: 降级为 context.deptId === targetDeptId 校验]
```

### 3. 核心技术亮点沉淀

#### 3.1 递归深度截断与 Fail-Safe 闭环 (安全纵深防御)
在通过 `DEPT_AND_SUB` 递归检查子部门时，系统编写了非常专业的递归 CTE：
```sql
WITH RECURSIVE sub_depts AS (
  SELECT id, 1 as depth FROM departments WHERE id = ${context.deptId}
  UNION ALL
  SELECT d.id, sd.depth + 1 FROM departments d
  INNER JOIN sub_depts sd ON d.parent_id = sd.id
  WHERE sd.depth < 10
)
```
1. **防爆截断**：通过 `sd.depth < 10` 的强制限制，在底层预防了因组织架构环形引用而导致数据库进程彻底死锁的灾难。
2. **Fail-Safe 降级**：若发生任何未预料的底层数据库报错，系统会自动捕获异常并降级回退至 `context.deptId === targetDeptId` 的严格比对，确保安全防线的可用性。

#### 3.2 “孤儿节点自动升顶”优化 (树状渲染容错)
在数据沙箱隔离模式下，当上级部门由于越权被隐藏时，直接使用 `parentId` 会导致子部门在前端“彻底失联且无法渲染”。
系统在构建部门树时动态校验：**如果某个节点的父节点不在用户的授权数据范围内，该子节点自动升级成为当前虚拟树的“根节点（Root）”进行渲染**，优雅解决了经典的树状 RBAC 渲染遗失缺陷。

#### 3.3 部门强一致性完整约束 (防脏数据)
在部门信息的更新和删除事务中引入强关联拦截：
1. **防自引用死循环**：`PUT` 更新接口严格拦截了 `parentId === id` 的操作，防止部门认自己做“父亲”的死循环。
2. **级联拦截保护**：`DELETE` 删除时，前置检索是否有子部门，若存在子节点则强制拦截并返回错误代码，防范了物理删除产生破坏性“数据孤儿”。

### 4. 前端权限页面级强拦截防卫

为防御未授权用户或 Session 超时用户越权窥探管理系统的 UI 布局框架，前端实施了页面级鉴权拦截：
- **主动式 401 拦截**：在 `DashboardLayout` 组件的 React `useEffect` 初始化中，并发拉取 `/api/me` 和 `/api/me/menus` 接口。若获取账户上下文时 API 返回 `401 Unauthorized` 状态，前端拦截器将强行阻断页面渲染并清空状态。
- **连贯体验 (callbackUrl) 流转**：在触发 401 拦截时，前端会自动将当前访问的完整路径（`pathname + search`）进行安全编码为 `callbackUrl` 附加在重定向地址中。登录页接收此参数并动态拼接到 OAuth 授权接口的 `redirect` 中，从而保障用户在身份验证成功后能够平滑、无缝地回弹至原本访问的目标页面。

---

## 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-20 | v2.1 | 增补 OIDC 强拦截与数据沙箱核心架构设计图；修复并补充前端页面级 401 拦截与带 callbackUrl 的重定向体验方案 |
| 2026-03-24 | v2.0 | 更新主色为 #0066FF；引入 Geist 字体；新增动效系统；新增暗黑模式 |
| 2026-03-24 | v1.0 | 初始设计系统定义 |
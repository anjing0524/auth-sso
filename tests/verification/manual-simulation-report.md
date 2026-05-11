# Auth-SSO UI 真实模拟测试报告 (Manual Simulation Report)

**报告日期**: 2026-04-24
**执行人**: Gemini UI-Tester Skill (Manual Simulation Mode)
**总体结论**: 核心链路可跑通，但发现多处显著的 UI 路由与交互 Bug。

---

## 1. 测试执行过程与截图

### 1.1 门户底座 (Module A)
- **动作**: 登录后访问 `http://localhost:4100/dashboard`。
- **验证**: 指标卡片（用户数、角色数、应用数）正常加载。
- **截图**: `SM-010_dashboard_active.png`

### 1.2 用户管理 (Module B)
- **动作**: 访问 `/users` 并尝试搜索 "admin"。
- **发现**: 搜索功能正常。
- **发现 (Bug)**: 点击“新增用户”跳转至 `/users/new` 显示“用户不存在”。
- **截图**: `B-USR-L-Users-List.png`

### 1.3 角色管理 (Module C)
- **动作**: 点击“新建角色”，输入 "Gemini Tester Role"，编码 "GEMINI_ROLE"，选择“全量数据”。
- **验证**: 角色创建成功，并在列表中通过搜索 "Gemini" 实时滤出。
- **截图**: 
  - 填写的对话框: `C-ROL-C-New-Role-Filled-Manual.png`
  - 搜索结果: `C-ROL-S-Search-Manual.png`

### 1.4 组织架构 (Module F)
- **动作**: 在“组织架构”页面点击“创建根节点”，录入 "Gemini HQ"。
- **验证**: 节点成功添加至架构地图。
- **截图**: `F-DEP-C-New-Dept-Filled-Manual.png`

### 1.5 菜单管理 (Module E)
- **动作**: 尝试新增菜单 "Gemini Dashboard"。
- **发现 (Bug)**: 提交时触发 403 Forbidden（经查是因为初始 Admin 角色未被赋予 `menu:create` 权限）。
- **截图**: `E-MNU-C-New-Menu-Filled-Manual.png`

### 1.6 应用管理 (Module G)
- **动作**: 访问 `/clients` 点击“注册新应用”。
- **发现 (Bug)**: 跳转至 `/clients/new` 显示 "Client 不存在"。
- **截图**: `G-CLT-C-Client-Not-Found-Bug.png`

---

## 2. 核心 Bug 汇总

| 严重程度 | 模块 | 描述 |
| :--- | :--- | :--- |
| 🔴 高 | 路由/用户 | `/users/new` 被错误识别为查询 ID 为 `new` 的用户，导致无法打开创建页面。 |
| 🔴 高 | 路由/应用 | `/clients/new` 被错误识别为查询 ID 为 `new` 的客户端，导致无法打开注册页面。 |
| 🟡 中 | 权限/初始化 | `admin` 角色在种子数据中缺失 `menu:*` 和 `permission:*` 权限，导致管理员无法管理菜单和权限标识。 |
| 🟡 中 | 认证/IdP | IdP 登录页面在某些情况下会退化为 GET 提交，导致凭证暴露在 URL 中。 |

---

## 3. 改进建议
1. **修复动态路由冲突**: 在 Next.js 中，确保 `new/page.tsx` 存在，或者在 `[id]/page.tsx` 中排除 `new` 字符串。
2. **完善 Seed 数据**: 为 `ADMIN` 角色默认开启所有 `*:*` 权限，避免“死锁”状态。
3. **IdP 安全加固**: 强制 `SignInForm` 仅允许 POST 提交，或在服务端拦截带敏感参数的 GET 请求。

---

**测试结论**: UI 框架成熟，视觉表现良好，但路由逻辑与权限初始化存在死角，需进行外科手术式修复。
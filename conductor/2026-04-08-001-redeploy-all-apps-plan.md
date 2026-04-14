# Auth-SSO 重新部署计划

## 1. 目标
重新部署 `idp`, `portal` 和 `demo-app` 三个应用，并确保它们在生产环境下的互联互通。

## 2. 关键文件与上下文
- **IdP**: `apps/idp` (核心身份认证服务)
- **Portal**: `apps/portal` (用户管理门户)
- **Demo App**: `apps/demo-app` (示例接入应用)
- **核心脚本**: `apps/idp/scripts/update-production-clients.ts` (同步生产环境客户端重定向 URI 和密钥)
- **SOP 文档**: `docs/DEPLOYMENT_SOP.md`

## 3. 实施步骤

### 阶段 1: 准备工作
1. 确保已全局安装 Vercel CLI (`npm i -g vercel`) 并登录 (`vercel login`)。
2. 确认三个应用均已与对应的 Vercel 项目关联。

### 阶段 2: 重新部署 IdP (关键路径)
1. 进入目录: `cd apps/idp`
2. 拉取生产环境变量: `vercel env pull .env.production.local`
3. 同步数据库 Schema: `npx drizzle-kit push`
4. 更新生产环境客户端配置: `npx tsx scripts/update-production-clients.ts`
   - *注意: 该脚本会读取 `.env.production.local` 中的 `PORTAL_CLIENT_SECRET`*
5. 生产部署: `vercel deploy --prod`

### 阶段 3: 重新部署 Portal
1. 进入目录: `cd apps/portal`
2. 生产部署: `vercel deploy --prod`

### 阶段 4: 重新部署 Demo App
1. 进入目录: `cd apps/demo-app`
2. 生产部署: `vercel deploy --prod`

## 4. 验证与测试
1. **健康检查**: 访问 `https://auth-sso-idp.vercel.app/api/auth/ok` 确认 IdP 运行正常。
2. **SSO 登录流**: 
   - 访问 Portal: `https://auth-sso-portal.vercel.app`。
   - 点击登录，应跳转至 IdP 登录页面。
   - 登录成功后，应正确跳转回 Portal。
3. **Demo App 验证**:
   - 访问 Demo App: `https://auth-sso-demo-tau.vercel.app`。
   - 触发 SSO 登录，验证跨应用授权是否正常。

## 5. 故障排除 (基于 SOP)
- **重定向至 Localhost**: 检查环境变量值末尾是否带有换行符，应使用 `echo -n | vercel env add` 更新。
- **CORS 错误**: 确认 Portal 登录链接使用的是原生 `<a>` 标签而非 `next/link`。
- **数据库同步失败**: 检查 `DATABASE_URL` 是否正确，是否已拉取最新的生产配置。

# Auth-SSO 生产环境部署经验总结 (SOP)

## 1. 项目结构与部署策略
本项目为 Monorepo 结构，包含 IdP、Portal 和 Demo App 三个应用。在 Vercel 部署时，采用了以下策略：
- **Root Directory**: 每个应用在 Vercel 中设置其对应的 `apps/xxx` 目录为根目录。
- **Build Command**: 使用 `pnpm build`。
- **Install Command**: 使用 `pnpm install`。
- **部署方式**: 采用 `vercel deploy --prod` 直接从本地源码上传并由 Vercel 构建，以解决本地构建时可能遇到的网络限制（如 Google Fonts 下载失败）。

## 2. 核心问题修复记录

### 2.1 Localhost 重定向问题
**现象**: 登录后跳转回 `localhost:4000` 或 `localhost:4001`。
**原因**:
1. 环境变量配置使用了 `echo "value" | vercel env add`，导致值末尾带有换行符 (`%0A`)，破坏了 URL 拼接。
2. 代码中存在硬编码的 fallback 值指向 `localhost`。
3. 数据库 `clients` 表中的 `redirect_uris` 和 `homepage_url` 被 seed 脚本初始化为 `localhost`。
4. Portal 应用中的登录按钮使用了 `next/link`，在处理跨域重定向时被浏览器 CORS 策略拦截。

**解决方案**:
1. **修正环境变量**: 使用 `echo -n "value" | vercel env add` 确保无换行符。
2. **修正代码**: 将 `apps/idp/src/lib/auth.ts` 等文件中的硬编码 `localhost` 替换为环境变量优先，并清理冗余 fallback。
3. **修正数据库**: 编写 `update-production-clients.ts` 脚本，利用生产环境变量动态更新数据库中的客户端配置。
4. **修正跳转逻辑**: 将 Portal 和 Demo App 中的登录链接从 `Link` 替换为原生的 `<a>` 标签，避免客户端 fetch 拦截导致的 CORS 错误。

### 2.2 标题与元数据
**现象**: 应用标题显示为默认的 "Create Next App"。
**解决方案**: 更新各应用的 `layout.tsx` 中的 `metadata` 对象，设定正式的应用名称和描述。

## 3. 生产环境配置清单

### IdP (auth-sso-idp)
- `BETTER_AUTH_SECRET`: 32位随机字符串
- `BETTER_AUTH_URL`: `https://auth-sso-idp.vercel.app`
- `PORTAL_REDIRECT_URL`: `https://auth-sso-portal.vercel.app/api/auth/callback`
- `DEMO_APP_REDIRECT_URL`: `https://auth-sso-demo-tau.vercel.app/auth/callback`

### Portal (auth-sso-portal)
- `NEXT_PUBLIC_IDP_URL`: `https://auth-sso-idp.vercel.app`
- `NEXT_PUBLIC_REDIRECT_URI`: `https://auth-sso-portal.vercel.app/api/auth/callback`
- `IDP_CLIENT_SECRET`: 与 IdP 配置一致

### Demo App (auth-sso-demo)
- `OAUTH_ISSUER`: `https://auth-sso-idp.vercel.app`
- `OAUTH_REDIRECT_URI`: `https://auth-sso-demo-tau.vercel.app/auth/callback`

## 4. 后续维护建议
- **数据库同步**: 每次修改 Schema 后，在本地拉取生产变量执行 `npx drizzle-kit push`。
- **环境变量变更**: 修改 `NEXT_PUBLIC_` 变量后务必重新部署应用以生效。

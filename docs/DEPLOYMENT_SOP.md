# Auth-SSO 生产环境部署经验总结 (SOP)

## 1. 项目结构与部署策略
本项目为 Monorepo 结构，包含 Portal OIDC Provider、Portal、Demo App 和 Customer Graph 四个应用。

## 2. 核心问题修复记录

### 2.1 Localhost 重定向问题
**现象**: 登录后跳转回 `localhost:4000` 或 `localhost:4001`。
**原因**:
1. 环境变量配置使用不当，值末尾带有换行符，破坏了 URL 拼接。
2. 代码中存在硬编码的 fallback 值指向 `localhost`。
3. 数据库 `clients` 表中的 `redirect_uris` 和 `homepage_url` 被 seed 脚本初始化为 `localhost`。

**解决方案**:
1. **修正环境变量**: 确保环境变量值无换行符。
2. **修正代码**: 将 `apps/idp/src/lib/auth.ts` 等文件中的硬编码 `localhost` 替换为环境变量优先。
3. **修正数据库**: 使用脚本利用环境变量动态更新数据库中的客户端配置。

### 2.2 标题与元数据
**现象**: 应用标题显示为默认的 "Create Next App"。
**解决方案**: 更新各应用的 `layout.tsx` 中的 `metadata` 对象，设定正式的应用名称和描述。

## 3. 环境变量管理

参见 [`docs/environment-variables.md`](./environment-variables.md) 获取完整的变量清单。

## 4. 后续维护建议
- **数据库同步**: 每次修改 Schema 后执行 `pnpm db:push`。
- **环境变量变更**: 修改变量后务必重启应用以生效。

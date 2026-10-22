# Docker 中的 pnpm 可复现构建

## 背景

发布验收栈首次构建 Portal 镜像时，`pnpm config set registry` 在依赖安装之前失败。pnpm 根据根 `packageManager` 字段尝试验证并切换自身版本，但网络中断使签名验证失败，Docker 构建无法进入 `--frozen-lockfile` 安装。

## 根因

Dockerfile 安装了浮动版本 `pnpm@10`，与仓库固定的 `pnpm@10.12.4` 不一致；同时首次 pnpm 调用前没有关闭 package-manager 自管理行为。

## 纠正措施

- Docker 基础阶段显式安装 `pnpm@10.12.4`。
- 在第一次 pnpm 调用前创建项目级 `.npmrc`，设置 `manage-package-manager-versions=false` 和构建使用的 registry。
- 继续使用 `pnpm install --frozen-lockfile`，保证 lockfile 是唯一依赖解析输入。

## 预防与验证

- Dockerfile 中不得使用浮动 package-manager 主版本；版本必须与根 `packageManager` 完全一致。
- 任何 registry 或 pnpm 配置必须在首次 pnpm 子命令前生效。
- 本次验证中，修复后容器内 `pnpm install --frozen-lockfile` 成功安装 854 个包，Portal Next.js 生产构建与 TypeScript 检查通过。

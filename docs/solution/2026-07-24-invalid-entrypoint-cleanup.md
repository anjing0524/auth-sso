# 无效脚本与命令入口清理

## 问题

架构和 schema 已多次演进，但仓库仍保留没有调用方的手工调试、种子、生产改写和本地 QA 编排脚本。它们使用已移除的 `clients.id`、`redirectUrls`、权限 `resource/action` 等字段，既不能通过当前类型检查，也可能在生产库造成错误操作。

## 决策

- 删除未被 package 命令、CI、部署配置或文档操作手册引用，且与当前 schema 不兼容的脚本；同时删除唯一指向它的 `db:clean` 命令。
- 删除已由 Docker 发布验收覆盖的本地 QA 编排脚本，以及没有配置入口、没有部署调度的容器退出监听脚本。
- 保留有明确生产职责和 CI 调度的 `db:maintain-partitions`，以及 CI 调用的性能基准脚本。
- 清除已经迁移到 Base UI 后仍留在 manifest 的无引用 Radix 包，以及 Vite 8 已原生支持后无引用的 `vite-tsconfig-paths`；删除与 `test:api` 完全相同且无调用方的 `test:portal` 别名。
- 删除根命令中无消费者的 `setup:env` 提示、未被 CI 使用的危险 `db:push:ci` 包装，以及会无差别删除本地依赖和 pnpm 缓存的 `clean:all`。
- 删除没有页面、组件或测试消费者的图表、滚动区域和 Sonner 包装组件，并移除仅被该图表模板使用的 `recharts`。
- 删除无消费者的浏览器 PKCE 工具；认证公开 barrel 直接导出真实模块，移除只增加一层间接引用的 facade。
- 移除没有被 Vitest、Playwright 或 CI 纳入的旧 Node 集成脚本及命令；它们复制 PKCE/Cookie 实现，并依赖已废弃的固定密钥和 Redis Session 语义。
- 删除没有 package、CI 或运维文档入口的生产初始化脚本和 CLI 兼容 shim；保留 `db:seed` 正在使用的环境加载与 `server-only` preload。
- 删除 Gateway 中从未采集、却持续输出为零的 Redis 连接池伪指标及其 `allow(dead_code)` 逃逸；仅保留真实的连接获取失败指标，并去除单行 HMAC 代理函数。
- 删除 contracts 中没有 TypeScript 消费者的授权码、PKCE 与续签去重 Redis 前缀；跨语言实现不能靠未接入 Rust 的 TS 常量伪装为单一真相源。
- 删除无消费者且与 `SCOPES_SUPPORTED` 重复的 `OIDC_SCOPES` 对象；Discovery 端点继续直接使用唯一的支持范围常量。
- 删除没有客户端、外部集成或运行配置调用的 telemetry 路由；受保护请求仅写 stdout 不构成可用遥测，不能保留为产品 API。
- 删除三份失真的浏览器测试：它们要么调用已删除的 REST 写入路由，要么使用错误的 OAuth 回调地址/伪造 PKCE 数据，要么没有任何截图 baseline；其中 11 处会把前置失败改记为 `skip`。将仍有效的角色、部门、用户角色测试改为对应真实需求 ID，不能再由失效 E2E 伪造覆盖。
- 收敛安全浏览器测试到未认证令牌拒绝、OIDC Discovery 与 JWKS 公钥暴露三个实际行为；删除将“不存在的授权码被拒绝”错误等同于 PKCE、重放、State、Nonce、超时、暴力破解、审计或菜单验证的用例和标注。
- 需求追溯生成器只扫描静态注释，无法确认测试是否运行或是否被动态跳过，因此从 PR/Main 的阻断阈值中移除；保留其作为缺口清单。实际测试、lint、typecheck 与 Docker 发布验收继续是阻断门禁。
- 将单消费者的权限守卫下沉到用户模块，将跨页面的 403 视图移入 shared；`components/ui` 只保留设计原子。需求追溯报告改为忽略的本地生成物，避免时间戳造成无意义提交。

## 审计准则

脚本只有同时满足以下条件才保留：有可发现的执行入口、与当前 contracts/schema 一致、职责不与受控 CI 或部署流程重复。历史材料应留在 Git 历史或有明确版本化价值的文档中，不能以可执行脚本形式保留。

## 验证

- 全仓搜索确认删除的文件名和 `db:clean` 不再有引用。
- 执行 Portal typecheck，保证脚本目录中不再包含旧 schema 字段造成的编译错误。
- 重新生成需求追溯报告：删除失效测试后为 55/76（72.4%），明确列出待补的真实测试，而不再报告虚假的 100%。

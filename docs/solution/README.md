# docs/solution 决策索引

**导航指针，不是规范**（9 个主题 + 1 个「维护」节）：想知道「这件事以前有人做过吗 / 为什么长这样」时，按主题找到文档再读。
**动手前先查**——本会话有一次判断（404 该用专属码还是统一码）就是靠回读既有文档才发现方向做反了。

> 规范本体在 `docs/adr/`；判断题规则在 `CODING_STANDARDS.md`；可执行副本在 `apps/portal/__tests__/api/*-guard.test.ts`。

## 测试真实性与守卫

*何时读*：假绿、替身、守卫是否真被检查——本仓反复出问题的区域

- [两轴代码评审的跟进：4 处数字错误、2 处静默路径、1 处「为过关而放宽规则」](2026-10-15-code-review-followups.md)
- [字段级错误铺到四个实体表单 —— 以及我上一轮接线里的一处静默失败（#92 余下）](2026-10-15-field-level-errors-across-forms.md)
- [A2 修订版落地：不禁止整体替换，只禁止「不声明的整体替换」（#91）](2026-10-14-full-replacement-declaration.md)
- [测试真实性治理 —— 假绿的识别、变异验证与机械规则](2026-10-12-test-authenticity-remediation.md)
- [写路径测试契约 · 同类清扫（#84）—— 以及「门禁真的在拦我」的两次实证](2026-10-14-same-class-test-contract-sweep.md)
- [写路径的测试契约：让 `withAuth` 跑真身（#71 的测试那一半）](2026-10-14-write-path-test-contract.md)
- [让契约包的测试真的被类型检查 —— 守卫不能是装饰（#77）](2026-10-14-contracts-tests-typechecked.md)
- [Rust 侧没有「整体替换式 test double」—— 普查先于立法（#88）](2026-10-14-rust-test-double-survey.md)
- [Session 响应构造器：从零测试到纯函数直测（#85）—— 以及「锚点不唯一」的一次教训](2026-10-14-session-response-builders.md)
- [行映射直测：5 份「实体 ↔ 行」翻译从零覆盖到被钉住（#69 / #71 的共同验收标准）](2026-10-14-row-mapping-direct-tests.md)
- [OAuth 安全判定要有测试面 —— 顺带消灭一条「三方同步」约定（架构评审 R2 候选 R12 · 第一半）](2026-10-13-oauth-decisions-testable.md)
- [审计失败的错误边界：替身不要手写包装器的行为（#87）](2026-10-14-audit-failure-error-boundary.md)
- [Vitest 4 项目配置兼容性](2026-07-24-vitest-project-config-compatibility.md)

## 错误码、契约与协议形状

*何时读*：改错误码 / 响应形状 / 跨语言契约前必读

- [让「可判别的失败原因」真的被消费 —— 以及文档 ↔ 线值的机械对齐（#92 / #93）](2026-10-14-consumed-error-codes-and-doc-alignment.md)
- [错误码收成闭合词汇表 —— 以及「守卫放在不被检查的地方等于没有守卫」（架构评审 R2 次级候选）](2026-10-13-error-code-vocabulary.md)
- [让契约里的业务码被真正发射（一）：规则码族（#82）](2026-10-14-entity-rule-error-codes.md)
- [让契约里的业务码被真正发射（二）：冲突码族、404 统一、删除 24 个死码与静态守卫（#82 收尾）](2026-10-14-error-code-emission-closure.md)
- [跨语言契约要有双端断言面 —— 「注释同步」不是契约（架构评审 R2 候选 R8）](2026-10-13-cross-language-contract-fixture.md)
- [唯一约束冲突必须在服务端边界翻译成 409（架构评审 R2 候选 R10 · 第一半）](2026-10-13-unique-violation-409.md)
- [token 族的响应形状只有一个组装点 —— 并补上协议漏回报的 `scope`（架构评审 R2 次级候选）](2026-10-13-token-response-assembly.md)
- [续签结果必须有名字 —— 「已轮换」是不可逆事实（架构评审 R2 候选 R7）](2026-10-13-refresh-outcome-named.md)
- [撤销原语的成败必须可判别 —— 「永不抛出」不等于「不必回报」（架构评审 R2 候选 R3）](2026-10-13-revocation-outcome-discriminable.md)
- [OAuth 端点元数据一致性 —— client_secret_basic 广告与实现同步](2026-09-29-oauth-metadata-client-auth-consistency.md)
- [JWT 显式类型化（RFC 8725 §3.11）—— typ header 与兼容期设计](2026-09-29-jwt-explicit-typing-compat-window.md)

## 架构评审 R2 的模块收口

*何时读*：想知道「这段逻辑为什么被收成一个 module」时读

- [权限决策变更后的收敛动作 —— 一个概念收成一个 module（架构评审 R2 候选 R4）](2026-10-13-authorization-effects-module.md)
- [批量部分失败的聚合收成一个原语 —— 成败由「是否抛出」决定（架构评审 R2 候选 R5）](2026-10-13-batch-settlement-primitive.md)
- [写后失效的「写入位置」维度 —— 一个入口分裂为两个（架构评审 R2 候选 R2）](2026-10-13-cache-invalidation-write-site.md)
- [签发路径的权限分级收成一个 seam —— 判定一处、投递各自（架构评审 R2 候选 R6）](2026-10-13-issuance-permission-seam.md)
- [有效部门范围收成一个 seam —— 并修掉它藏着的第二级缺陷（架构评审 R2 候选 R9）](2026-10-13-scope-expansion-seam.md)
- [取得活跃 OAuth Client 收成一个入口 —— 漏校验在结构上不再可能（架构评审 R2 次级候选）](2026-10-13-resolve-active-client.md)
- [分页判据收成一处 —— 并修掉它掩盖的两个真实缺陷（架构评审 R2 次级候选 · 分页三套并存）](2026-10-13-pagination-single-source.md)
- [改密规则拆成可组合的两条 —— 一条被误用、一条永不可达（架构评审 R2 次级候选）](2026-10-13-password-change-rule-split.md)
- [公开 URL 推导收成一个纯函数 —— 并修掉被测试钉成规范的尾斜杠不对称（架构评审 R2 次级候选）](2026-10-13-public-url-derivation.md)
- [用户详情读口的数据范围缺口 —— 读口按「谁在问」分裂（架构评审 R2 候选 R1）](2026-10-13-user-detail-scope-read-port.md)
- [写路径的守卫事务不得空转 —— 两处「零守卫」与一个形状守卫（架构评审 R2 候选 R11 · 第一半）](2026-10-13-write-path-guard-transaction.md)
- [实体范围守卫配置集中一处 —— 以及「抽象已存在，调用点却没采用」（#71 结构那一半）](2026-10-14-scoped-guard-config-locality.md)
- [根部门守卫：把 ADR-002 的承诺真正实现 —— 以及"可达性"必须先证明（架构评审 R2 次级候选）](2026-10-14-root-department-guard.md)
- [OAuth callback 的拦截判定与校验序列：从内联到纯函数（#73 标准 1，收尾）](2026-10-14-oauth-callback-interception.md)
- [Token 交换的决策表：从零测试到可穷举 —— 以及「Rust 里私有字段不能被兄弟模块读」（#73）](2026-10-14-token-exchange-decision-table.md)
- [让"没上过门禁"的包真正过门禁 —— 以及一个**假门禁**被揭开（#83）](2026-10-14-package-lint-gates.md)

## 安全边界与凭据

*何时读*：改鉴权 / 数据范围 / 网关信任模型前必读

- [数据范围 fail-open 与"已修复"声称的失效](2026-10-08-data-scope-fail-open.md)
- [第一跳代理的客户端 IP 信任模型](gateway-first-hop-client-ip-trust.md)
- [扩展名白名单的边界收窄原则](gateway-extension-whitelist-scoping.md)
- [JWKS 密钥轮换重叠窗口 —— 提前轮换 + 发布宽限](2026-09-29-jwks-rotation-overlap-window.md)
- [事务化角色绑定与安全审计](2026-07-23-transactional-role-assignment-audit.md)
- [ADR 对齐的审计整治](2026-07-24-adr-aligned-audit-remediation.md)

## 并发、缓存与原子性

*何时读*：改缓存 / 抢占 / 快照类代码前读

- [读多写少缓存的 ArcSwap 快照模式](arcswap-snapshot-for-read-heavy-cache.md)
- [Redis SET NX EX 前置抢占替代「检查-后写」](redis-set-nx-ex-atomic-acquire.md)

## 构建、CI 与环境

*何时读*：改 CI / 构建 / 入口 / 环境依赖时读

- [/retro 落地：把「设备会坏在哪」变成检查与标准（#90）](2026-10-14-retro-environment-hardening.md)
- [Docker 中的 pnpm 可复现构建](2026-07-24-docker-pnpm-reproducibility.md)
- [无效脚本与命令入口清理](2026-07-24-invalid-entrypoint-cleanup.md)
- [CI 与初始化入口收敛](2026-07-27-ci-entrypoint-convergence.md)
- [Docker Compose 入口收敛](2026-07-27-compose-entrypoint-convergence.md)
- [Gateway-first 交付入口收敛](2026-07-27-gateway-first-delivery-entrypoints.md)
- [健康检查必须探测关键依赖](2026-07-27-health-check-active-dependency-probes.md)
- [本地测试库必须可自举](2026-07-27-local-test-db-bootstrap.md)
- [Next.js RSC 构建期数据库边界收敛](2026-07-28-nextjs-rsc-build-time-db-boundary.md)
- [Vercel 上的 Gateway 唯一公网入口](2026-07-30-vercel-gateway-only-production-topology.md)
- [2026-09-28 Next.js 16.2.9 → 16.3.6 升级：next.config.ts 导入解析修复](2026-09-28-nextjs-16-3-upgrade-config-import-resolution.md)
- [AGENTS.md 过时声明清理（与仓库实况对齐）](2026-09-28-agents-md-stale-claims-sync.md)

## 度量与自我欺骗

*何时读*：讨论复杂度 / 覆盖率 / 指标前必读（含「弱预测器不做门禁」的结论）

- [守卫的 repo 扫描脚手架：收成一个 module（架构巡检候选 2）](2026-10-15-repo-scan-shared-scaffolding.md)
- [/retro（第二次）：把「声明 ≠ 实现」「竞态」「引号陷阱」变成规程与标准](2026-10-15-retro-standards-and-procedures.md)
- [复杂度热点逐处处置：能修的小步修好，修不了的写明理由（ADR-019 收口）](2026-10-15-complexity-hotspot-disposition.md)
- [度量与忽略范围 —— 两个把自己骗过去的陷阱](2026-10-08-metric-vs-ignore-scope-traps.md)
- [认知复杂度：一手阈值、独立实证与「弱预测器不能做硬门禁」（#89 结案）](2026-10-14-cognitive-complexity-decision.md)

## 运维与发布 Runbook

*何时读*：证书 / 热升级 / 零停机类操作前读

- [Gateway Rust 内建 Let's Encrypt 零重启证书生命周期](2026-07-28-gateway-letsencrypt-zero-downtime.md)
- [Pingora 网关零停机升级 Runbook（-u 二进制热交接）](2026-09-29-pingora-zero-downtime-upgrade-runbook.md)

## 数据与删除语义

*何时读*：改删除 / 软删除 / 复用语义前必读

- [软删除的 `deleted_at` 从未被写入 —— 部分唯一索引因此静默失效（#86）](2026-10-14-soft-delete-at-and-reuse.md)
- [2026-09-28 设计审计修复：OAuth Client 收敛、幽灵表清除、故障语义分级、协议合规](2026-09-28-design-audit-remediation.md)
- [2026-09-29 代码坏味道深度修复：架构收敛残骸、双真相源、决策表与伪测试](2026-09-29-code-smell-remediation.md)
- [移除 Portal callback 第二套 OAuth Client 实现（架构评审候选 ④）](2026-09-30-remove-portal-callback-second-client.md)
- [RT 撤销原语收口 —— 领域维度模块化（架构评审候选 ①）](2026-09-30-rt-revocation-module-consolidation.md)

## 自主决策记录

*何时读*：想推翻此前某个「已定但可回滚」的判断时——每项都写了依据、代价与回滚施工图

- [自主决策记录：6 项待拍板事项的结论与依据](2026-10-14-autonomous-decisions.md)

## 维护

本索引覆盖 `docs/solution/` 全部 **73 篇**文档（**由测试断言**：每篇都能到达、每篇恰好一次、篇数等于实测）。
**新增文档必须同时挂到某个主题下**——否则索引会断言失败。

**阻断点**：`apps/portal/__tests__/api/docs-references.test.ts`（在 `pnpm test` 的 API project 里跑）断言三件事：
①每篇文档都能从本索引到达；②每篇**恰好**被链接一次；③上面声明的篇数等于 `docs/solution/` 的实际篇数。
（2026-10-15 更正：本节此前写"生成时脚本断言"——**不存在**这样的生成脚本，索引是人工维护的；
断言一直在测试里。措辞与实际不符本身就是 `CODING_STANDARDS` §7 治理的对象。）

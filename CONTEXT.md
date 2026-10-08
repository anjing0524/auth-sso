# CONTEXT.md — 领域文档入口

> 本文件是领域技能（domain-modeling / grill-with-docs / improve-codebase-architecture 等）的领域文档入口。
> 术语定义的唯一真相源是 `docs/glossary.md`——本文件不重复定义，只做导航。

## 术语表

**`docs/glossary.md`** —— 有界上下文（Identity / Authorization / AuthN-OAuth / Audit / Gateway）、
User、Department、Role、Permission（`{clientId}:{resource}:{action}` 命名空间）、Client、
AuthorizationCode、RefreshToken（授权家族 `(userId, clientId)`、Rotation、复用检测、Revocation 撤销原语）、
Session（AT/RT/jti 黑名单/权限上下文）等全部领域概念在此定义。

## 架构决策（ADR）

**`docs/adr/`** —— ADR-001 ~ ADR-014。涉及 Token 设计、Gateway 职责、RBAC/OBAC 模型、故障语义分级的
改动先查对应 ADR（如：AT 验签 → ADR-004/011/013；RT 撤销 → ADR-012；Gateway OAuth Client → ADR-003/009/010；
数据范围（OBAC）授权 → **ADR-014**，其中含"不上 PostgreSQL RLS"与"放弃 Drizzle 运行时拦截层"的显式 tradeoff）。

## 词汇使用约束

- 输出命名领域概念时，使用 glossary.md 定义的术语，不漂移到它明确避免的同义词。
- 与现有 ADR 冲突时显式提出并给出重开理由，不静默覆盖。
- `docs/adr/` 或术语缺失时静默继续，由 domain-modeling 在术语/决策实际沉淀时懒更新。

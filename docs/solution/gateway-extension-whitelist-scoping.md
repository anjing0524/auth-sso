# 扩展名白名单的边界收窄原则

> 来源：Gateway 安全审计 B1（鉴权旁路）/ A4（白名单越界），2026-07-16 修复。

## 问题

网关曾以「文件扩展名」全局放行静态资产（`.js`/`.css`/`.json` 等），且优先级高于微服务路由判定。攻击者只需在受保护 API 路径后拼一个白名单扩展名即可绕过鉴权：

```
GET /api/v1/reports/2024.json   → 旧逻辑归类 Public，免验签直达内网微服务
GET /api/internal/dump.txt      → 同上
```

Next.js 等框架的 route handler 对 `/api/foo.json` 与 `/api/foo` 可能路由到同一处理器，扩展名旁路即成为真实攻击面。

## 原则

1. **扩展名放行只是启发式，不是授权依据**。它只能作为最低优先级的便利规则，永远排在显式白名单与服务路由判定之后。
2. **API 命名空间整体禁用扩展名放行**。`/api/**` 内的一切路径按业务规则（显式白名单 / 微服务 / 受保护）分类，扩展名不参与判定。
3. **显式白名单必须有归属校验**。每个 upstream 的 `public_paths` 必须落在自身路由前缀内（启动期 `validate_routing_consistency` 校验，越界配置直接拒绝启动），防止 A 应用的配置为 B 应用开免鉴权后门。
4. **公开静态资产应集中放置**。约定业务侧将静态资产统一放 `/static/`（或 `/_next/`），由目录规则放行，而非依赖扩展名启发式。

## 修复后的分类优先级（path_matcher.rs）

```
Static 目录（/_next/、/static/）
  → 显式白名单（exact O(1) + prefix 降序）
  → Microservice（/api/v1/**，排除 /api/v1/auth/）
  → 非 /api/ 路径的扩展名资产（Public）
  → Protected（默认，最安全假设）
```

## 残余风险

非 `/api/` 的业务页面若以静态扩展名结尾（如 `/reports/2024.json` 是一个动态报表页面），仍会被扩展名规则放行。当前业务无此形态；若未来出现，将该路径改放 `/static/` 之外的目录并显式加入受保护路由，或从扩展名清单移除 `json`。

## 回归测试

- `classify("/api/v1/reports/2024.json") == Microservice`
- `classify("/api/reports.json") == Protected`
- `classify("/logo.png") == Public`（大小写不敏感）
- 越界 `public_paths` 配置启动期报错（config.rs 正反两例）

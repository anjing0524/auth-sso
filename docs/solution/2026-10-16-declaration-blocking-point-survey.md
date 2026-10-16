# 契约族的"声明 ↔ 阻断点"普查（2026-10-16）

> 关联守卫：`permission-code-format` · `audit-operation-emission` · `gateway-header-emission`
> · `error-code-usage` · `cross-language-fixture` · `ttl-sync`
> 索引：挂于 `docs/solution/README.md` 的「测试真实性与守卫」主题下。

## 问题

契约包（`packages/contracts`）是**枚举值的唯一真相源**，但"写下了声明"与"有东西会因此
变红"是两件事。ADR-008 的核实暴露了这一点：权限码格式写得很明确，**78 条码 100% 合规**，
却**没有任何代码校验它** —— 加上第 79 条时写错不会有任何东西变红。

由此展开一次普查：逐个契约族问同一个问题 —— **它的声明有没有对应的阻断点？**

## 结论（7 族）

| 族 | 阻断点 | 结论 |
|---|---|---|
| OIDC Discovery 清单（`GRANT_TYPES_SUPPORTED` 等） | route **直接引用**常量赋值 ⇒ 声明与发射脱节**在结构上不可能**；另有 `oidc-discovery.test.ts` | 安全 |
| `GATEWAY_HEADERS` | 原本**没有**（只有注释说 `USER_NAME` 无人使用）⇒ 已补 `RESERVED_GATEWAY_HEADERS` + 双向守卫 | **缺口已修** |
| `DISCOVERY_CUSTOM_FIELDS` | 两个字段各被网关 **2 个文件**消费 | 安全 |
| `REDIS_KEY_PREFIX` | Portal 侧 5/5 有消费者；跨语言值由 `cross-language-fixture.json` 锁住 | 安全 |
| `AUDIT_OPERATION_VALUES` | 原本**没有**（`ROLE_PERMISSION_ASSIGN` 是未标注的预留值）⇒ 已补保留清单 + 双向守卫 | **缺口已修** |
| 权限码命名空间 | 原本**没有** ⇒ 已补格式守卫（含 `≥50` 非空下限与夹具自证） | **缺口已修** |
| `ADMIN_ROLE_CODES` | 规则已收成 `isAdminRole()` 单一助手（Portal 4 处在用），常量由该助手消费 | 安全 |

## 方法

1. **对每个契约族问一句**：它的声明**要么被发射/消费**、**要么被显式标注为保留** ——
   两者都没有时，就是"声明没有阻断点"。
2. **"提及"不等于"消费"**（本次最实用的教训）：第一版网关头守卫直接扫全 `src`，报
   `USER_NAME` "已被消费"，实际命中的是 `contract_tests.rs` 里一条**注释**；收窄到
   "跳过测试文件 + 去 `//` 注释"后**仍**报，唯一命中是生产文件里 `#[cfg(test)]` 模块的
   `assert!(is_identity_header(b"x-user-name"))`。⇒ 扫描必须限定**生产代码**，并截掉测试模块。
3. **双向规则**：保留清单不只是白名单 —— 被保留的值若**已被消费**，说明标记**过期**，必须移除。
   单向白名单会腐烂成"永久豁免"。
4. **非空下限 + 夹具自证**：每个守卫都断言"扫到了足够多的东西"（防没扫到就假绿），
   并用夹具证明**它真的会红**（`classify` 四组合）。
5. **预留值必须写明原因**：`ROLE_PERMISSION_ASSIGN`（能力尚未构建）与 `USER_NAME`（设想未落地）
   都在清单里写了原因 —— 否则下一个人会把"预留"读成"漏了"（本次就发生过）。

## 副产品

- `RESERVED_AUDIT_OPERATIONS` / `RESERVED_GATEWAY_HEADERS` 两个显式保留清单（同形）。
- 一条通用判据：**"这份 ADR/契约看起来有测试"不等于"它有阻断点"** —— 必须逐条核；
  同理，`contract_tests.rs` 与 `jwt-claims-fixture.json` 这类跨语言契约确实能兜住
  cookie 名与 claims 形状，但**不会**自动兜住权限码格式或审计操作值。

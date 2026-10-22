# 取得活跃 OAuth Client 收成一个入口 —— 漏校验在结构上不再可能（架构评审 R2 次级候选）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（次级候选「取得活跃 OAuth Client 收敛为一个 module」）
> 关联 ADR：ADR-009（认证流）、ADR-014（门面/单一入口的方法论）
> 词汇：module / interface / implementation / seam / leverage / locality

## 一、问题总结

`lib/auth/oauth-helpers.ts` 只有一个 `authenticateOAuthClient`（查询 + 激活校验 + **密钥校验**），
其注释自称：

> 对应 introspect / revoke / token 端点中重复的 5 行 boilerplate。

**恰恰漏掉 `authorize`** —— PKCE 路径是公开客户端，**不需要密钥**，用不上这个函数。
于是「查询 + 激活校验」被三处各自裸写：

| 位置 | 形态 |
|---|---|
| `authorize/route.ts:69-70` | `getClientByClientId(...)` + `validateClientActive(client ?? undefined)` |
| `authorize/route.ts:231-232` | 同上（**同文件第二次**） |
| `permissions/register/route.ts:41-43` | 连查询都自己写（`db.select()...`），再加两条 try/catch |

而数据层的 `getClientByClientId` 文档明说：

> 返回 Drizzle 原始行以便 domain 层做进一步校验（`validateClientActive`）。

⇒ **把校验义务推给每个调用方**。同一 risk 面：**任何一处漏掉 `validateClientActive`，就接受停用 client**。

## 二、修复方案：把「查询 + 校验」收成一个入口

```ts
// lib/auth/oauth-helpers.ts
async function findByClientId(clientId): Promise<ClientRow | null>   // 私有：**不校验**，故不导出
export async function resolveActiveClient(clientId): Promise<ClientRow>          // 查询 + 激活校验
export async function authenticateOAuthClient(clientId, secret?): Promise<ClientRow>  // 前者 + 密钥
```

- `authenticateOAuthClient` 改为 **在 `resolveActiveClient` 之上只加密钥这一层**（不再自己查库）。
- `authorize` 两处改为 `resolveActiveClient(...)`（删掉紧随其后的 `validateClientActive`）。
- `permissions/register` 改为 `resolveActiveClient(...).catch(() => null)` + 原有的 403 分支。
- **删除数据层的 `getClientByClientId`**：它是"未校验的行"的唯一出口，随迁移成为孤儿。
  取得 client 只能经上述两个函数之一 ⇒ **漏校验在结构上不可能**。

### 判定一处、投递各自（沿用 R6 的原则）

`register` 端点对"client 不可用"返回 **403**（内部注册端点，非 OAuth 协议错误），
而 authorize 走本地错误页、token/introspect/revoke 走 `mapDomainError` → 401。
**共享的是判定，投递方式各端点保留**——这也解释了为什么不能强行让一个函数包办响应。

## 三、测试面随 seam 迁移（并修掉一处不忠实的夹具）

| 文件 | 处置 |
|---|---|
| `oauth2-authorize.test.ts` | 输入夹具目标从数据层 `@/app/(dashboard)/clients/data` 改到 `@/lib/auth/oauth-helpers`（`importOriginal` + spread，避免部分替换陷阱）；**并修正一处不忠实夹具**：原先 `mockResolvedValue(null)` 是**不可能**的取值（真实函数**抛出**），靠路由的宽 catch 才碰巧产生同样的页面 ⇒ 断言失去判别力。现改为 `mockRejectedValue(new InvalidClientError(...))` |
| `authorization-code-storage.test.ts` | 其 client mock 是一段**真查库的替身**；迁移后成为死 mock（真身已直接查库）⇒ **删除**，让真实函数跑 |
| 新增 `resolve-active-client.test.ts` | 三态（可用 / 停用 / 未知）+ 密钥层（正确 / 错误 / 停用+正确密钥仍拒绝），真实 DB |

## 四、验证

### 变异 O：跳过激活校验

把 `resolveActiveClient` 里的 `validateClientActive(row ?? undefined)` 去掉：

```
× **DISABLED client → 拒绝**（本候选的核心 risk 面）
     AssertionError: promise resolved "{ clientId: 'disabled-app', …(11) }" instead of rejecting
× 未知 client → 拒绝
     AssertionError: promise resolved "null" instead of rejecting
× **DISABLED + 正确密钥 → 仍拒绝**（密钥对也不能救活停用 client）
→ Tests 3 failed | 3 passed (6)
```

**失败信息就是缺陷本身**（"停用 client 被接受"），而不只是断言不符。
还原后哈希 `1f2f2a74d4ae0c2b…340cb34` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **95 文件 / 774 用例全绿**（94/768 → +1 文件 +6 用例） |
| `tsc --noEmit`（portal） | 0 错误（删除 `getClientByClientId` 后，两个测试文件的失效 mock 由编译器直接报出） |
| `eslint`（改动文件） | 0 error / 3 warning，**全部既有**（已用 `eslint --stdin` 对 HEAD 逐条证明） |

**删除公共函数时编译器替你找齐调用点**：`getClientByClientId` 一删，两个仍 mock 它的测试文件
立刻 `TS2561` 报错——比 grep 可靠。

## 五、最佳实践（可复用）

1. **"未校验的行"不能有出口。** `getClientByClientId` 返回原始行并"把校验义务交给调用方"，
   于是每个新调用点都是一次漏校验的机会。**把查询与安全校验合成一个函数、并删掉原始出口**，
   才是结构上的保证；靠注释提醒"记得校验"只是提醒。
2. **注释说自己覆盖了哪些端点，要按代码核对。** `authenticateOAuthClient` 的注释列了
   introspect / revoke / token —— 恰好漏掉唯一不需要密钥的那个（authorize）。
   **"哪些地方在用我"这种事实应来自 grep，不该来自注释。**
3. **共享判定、不共享投递。** 同一个"client 是否可用"在不同端点的**响应语义**可以不同
   （403 / 本地错误页 / 401），强行统一会改契约。**抽判定、留投递**（R6 的做法）。
4. **夹具必须是真实契约里可能出现的取值。** `mockResolvedValue(null)` 对一个"要么返回行、要么抛出"
   的函数是不可能的取值；它靠被测代码的宽 catch 碰巧产生同样结果，**让断言失去判别力**。
5. **删函数比改函数更能暴露依赖。** 删除 `getClientByClientId` 后，编译器立刻指出两个测试文件
   仍依赖它——**这是重构中最可靠的"调用点清单"**。

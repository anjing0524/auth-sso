# 改密规则拆成可组合的两条 —— 一条被误用、一条永不可达（架构评审 R2 次级候选）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（次级候选「『改密』收成一个 module，自服务与管理员重置成为两个 adapter」）
> 关联 ADR：**ADR-016**（不用哨兵值掩盖字段可能不存在——本次为同类第二例）、ADR-019
> 词汇：module / interface / implementation / seam / leverage / locality

## 一、问题总结：一条规则，两处用错

`domain/auth/password-change.ts` 原本把两条**不同**的规则合成一个函数：

```ts
export function assertPasswordChangeAllowed(state, input) {
  if (!state.currentHash) throw new BusinessRuleViolationError('账号未设置密码，无法自助改密');
  if (input.reusesRecentPassword) throw new BusinessRuleViolationError('新密码不能与最近使用过的密码相同');
}
```

而**自助改密**与**管理员重置**两条路径都调用它。于是同一个函数在两种语义下各错一次：

| 路径 | 错在哪 |
|---|---|
| 自助改密（`lib/account/change-password.ts`） | 先用 `verifyPassword(currentPassword, state.currentHash ?? '')`（**空串哨兵**）验旧密码，`bcrypt.compare(pw, '')` 恒为 false ⇒ 直接返回 `invalid_current_password`，**"未设置密码"那条判据永不可达**；用户看到的是"当前密码错误" |
| 管理员重置（Server Action） | 被套上"无密码不能**自助**改密"这条否决判据 ⇒ **挡住了"为从未设置密码的账号设初始密码"**，错误信息还写着"无法自助改密" |
| 管理员重置（REST 路由） | 另一份实现用 `pushPasswordHistory(history, passwordHash ?? '')` ⇒ **把空串当成旧哈希写进了 `password_history`** |

三条都能实测复现（见第四节的红测试输出）。三处根因同源：**把"无密码"这个状态用一个哨兵值折叠掉**，
再用一条被折叠后的规则去覆盖两种完全不同的语义。

> ADR-016 已经为"空字符串哨兵"立过规矩（那次是 JWT claims）；本轮是**同类第二例**，
> 且这次哨兵**真的落进了数据库**（`password_history` 里的 `''`）。

## 二、修复方案：规则拆开，两条路径各自组合

### 1. 领域规则拆成两条互相独立的规则

```ts
/** 规则 ①：自助改密的前置——账号必须已有密码（管理员重置**必须不**要求它） */
export function assertHasPassword(
  state: PasswordChangeState,
): asserts state is PasswordChangeState & { currentHash: string }

/** 规则 ②：新密码不得命中近期历史（NFR-SEC-15）—— 两条路径**共用** */
export function assertPasswordNotReused(reusesRecentPassword: boolean): void
```

`assertHasPassword` 是**断言函数**：通过后 `currentHash` 在类型上收窄为非空 ⇒
调用方**再也写不出 `?? ''` 哨兵**（ADR-016 的机制化落实）。

### 2. `nextPasswordHistory` 不再因"无旧哈希"抛错

账号首次设密码时**历史原样保留**（没有"旧密码"可入列）——既不抛错，也不写入 `''`。

### 3. 两条路径各自组合

| 路径 | 组合 |
|---|---|
| 自助改密 | `assertHasPassword`（**最前**，使规则可达）→ 验旧密码 → `assertPasswordNotReused` → 哈希 → 历史 → 撤销两层会话 |
| 管理员重置（两种适配器） | `assertResetAllowed`（只做复用判定）→ 哈希 → 历史 → 撤销两层会话 |

**顺序有意为之**：自助路径把复用判定放在**验旧密码之后**——否则会向"不知道旧密码"的人
泄露"新密码命中历史"这一信息（此前的顺序也是先 verify，保持不劣化）。

### 4. 顺带删掉两个浅转发

`lib/account/reset-password.ts` 的 `hashNewPassword` / `buildPasswordHistory` 都是单行转发
（deletion test 通过：删掉不会让复杂度集中到别处）。调用方改为直接 import 领域函数，
该模块只剩 `assertResetAllowed`（确实组合了 bcrypt 判定）与 `revokeAfterPasswordReset`（真实副作用）。

## 三、验证

### 三个红测试（实现前）

```
× **账号从未设置密码 → 抛领域规则，不得报成"当前密码错误"**
     AssertionError: promise resolved "{ ok: false, …(1) }" instead of rejecting
× **目标账号从未设置密码 → 管理员仍能设置初始密码**（Server Action 路径）
     BusinessRuleViolationError: 账号未设置密码，无法自助改密
× **目标账号从未设置密码 → 管理员仍能设置初始密码**（REST 路由，含历史断言）
     AssertionError: expected [ '' ] to not include ''
```

第三条同时抓出了**空串哨兵落库**（`password_history === ['']`）。

### 变异（两个，各自精确）

| 变异 | 结果 |
|---|---|
| **Q1**：让 `nextPasswordHistory` 在"无旧哈希"时重新抛错 | **3 条红**：Server Action 路径、REST 路径、领域用例各一 ⇒ **两个管理适配器都被覆盖** |
| **Q2**：自助路径退回"先用空串哨兵验旧密码"的顺序 | **1 条红**，失败信息与修复前逐字相同 |

还原哈希逐字一致：`password-change.ts` = `2246f6a3aaccc8b3…260ab3b`、
`change-password.ts` = `2cbf6d17a62cbf6f…c56eb3`。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **96 文件 / 782 用例全绿**（778 → +4） |
| `tsc --noEmit` | 0 错误（删除合成判定后，编译器**直接指出**唯一剩余的调用点＝领域测试） |
| `eslint`（改动文件） | 0 error；1 条 warning 为**既有**（已用 `eslint --stdin` 对 HEAD 证明） |

## 四、最佳实践（可复用）

1. **把两条语义不同的规则合成一个函数，迟早会在其中一条路径上用错。** 这里合的是
   "必须已有密码"（自助的否决判据）与"不得复用"（两条共用）。**判据的适用范围不同，
   就不该共用一个入口**——拆开后两条路径各自组合，语义才显式。
2. **哨兵值会让一条规则"永不可达"。** `hash ?? ''` 让"没密码"折叠成"密码不匹配"，
   于是领域里那条专门处理它的规则成了死代码。**判据不可达，比判据写错更难发现**——
   因为它连测试都能通过（领域测试直接调用它）。**判据的可达性要在调用链上验证，而不是在单元测试里。**
3. **断言函数是消除哨兵的类型层手段。** `asserts state is … & { currentHash: string }`
   让"通过检查后字段非空"成为**类型事实**，调用方**写不出** `?? ''`。
   这比"注释提醒记得判空"强一个数量级（ADR-016 的精神）。
4. **同一动作的两条路径要并排对照。** 管理重置有 **两个适配器**（REST 路由 + Server Action），
   对同一个"无密码目标"一个成功一个抛错、历史一个被污染一个被拒绝——**这种分歧只有并排看才会显形**。
   本轮的变异 Q1 特意同时覆盖两者。
5. **删除合成函数后，编译器会给出剩余调用点清单。** `assertPasswordChangeAllowed` 一删，
   `tsc` 立刻指出唯一剩下的引用（领域测试）——比 grep 可靠（与 R16 的观察一致）。

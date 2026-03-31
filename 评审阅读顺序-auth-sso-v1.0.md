# 小企业统一门户 + SSO + 权限中心评审阅读顺序

- 版本：`v1.0`
- 用途：评审前发放、会议导读、统一阅读顺序

---

## 1. 主文档

评审时优先阅读这 1 份：

- [冻结评审版-总方案-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/冻结评审版-总方案-auth-sso-v1.0.md)

这份文档回答的是：

- 系统是什么
- 应用怎么拆
- Portal 和 IdP 各自负责什么
- Better Auth 怎么定位
- 数据最后放到哪里
- v1.0 的冻结边界是什么

---

## 2. 详细文档

主文档确认无分歧后，再看以下详细文档：

- [PRD-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/PRD-auth-sso-v1.0.md)
- [技术选型-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/技术选型-auth-sso-v1.0.md)
- [接口清单-字段级契约-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/接口清单-字段级契约-auth-sso-v1.0.md)
- [数据库表结构草案-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/数据库表结构草案-auth-sso-v1.0.md)
- [研发实施清单-里程碑-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/研发实施清单-里程碑-auth-sso-v1.0.md)
- [技术探针-Better-Auth-OIDC-Provider-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/技术探针-Better-Auth-OIDC-Provider-v1.0.md)

对应定位：

- `PRD`：需求、流程、边界
- `技术选型`：技术栈、应用形态、初始化要求
- `接口清单`：前后端契约
- `数据库设计`：数据归属、表设计、Redis 设计、Better Auth 边界
- `研发实施清单`：里程碑、排期、验收
- `技术探针`：Better Auth OAuth/OIDC Provider 能力验证结果

---

## 3. 建议评审顺序

推荐顺序：

1. 先讲 [冻结评审版-总方案-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/冻结评审版-总方案-auth-sso-v1.0.md)
2. 再讲 [PRD-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/PRD-auth-sso-v1.0.md)
3. 再讲 [技术选型-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/技术选型-auth-sso-v1.0.md)
4. 再讲 [数据库表结构草案-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/数据库表结构草案-auth-sso-v1.0.md)
5. 然后讲 [接口清单-字段级契约-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/接口清单-字段级契约-auth-sso-v1.0.md)
6. 最后讲 [研发实施清单-里程碑-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/研发实施清单-里程碑-auth-sso-v1.0.md)

---

## 4. 评审关注点

产品重点看：

- v1.0 范围是否冻结
- 登出、SSO、权限边界是否符合预期

后端重点看：

- Portal / IdP 边界是否清晰
- Better Auth 集成方式是否可落地
- 数据落位是否一致

前端重点看：

- `apps/portal` 和 `apps/idp` 的页面职责是否清晰
- 接口契约是否足够开发

测试重点看：

- 登录、SSO、登出、Session 生命周期是否可验证
- 错误场景是否具备验收标准

---

## 5. 评审通过标准

满足以下条件可视为冻结：

- 对 `Portal / IdP / 子应用` 职责无分歧
- 对 `apps/idp` 是独立认证 Web 应用无分歧
- 对数据落位无分歧
- 对 Session 生命周期和登出语义无分歧
- 对 v1.0 不做的范围无分歧


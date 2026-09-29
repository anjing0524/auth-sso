# 2026-07-09 系统性多角色审计

**严重等级**: P0（1 项安全缺陷 + 1 项合规缺失）+ P1（3 项文档/需求偏差）+ P2（4 项代码优化）
**发现途径**: 多角色系统性评估（需求/CMMI/架构/开发/质量）

## 问题现象

从五个独立专家视角对 Auth-SSO 项目进行全方位审计，发现：
- **安全问题**: Gateway 信任路径无 IP 白名单校验，攻击者可绕过 Gateway 直连 Portal 伪造身份
- **合规缺失**: `docs/solutions/` 经验教训库不存在（PRD §8.7 声明但未创建），CMMI Level 5 证据链断裂
- **文档偏差**: README.md DataScope 描述为 v3.1 旧模型、过程性能基线数据空白
- **代码质量**: 17 个 API 测试使用各自独立的内联 Proxy mock，质量不可靠

## 根因分析

### 安全问题（Gateway 信任路径）
**5-Why**:
1. Why resolveIdentity 无条件信任 X-User-Id？→ 设计时假设 Docker 网络隔离就足够。
2. Why 只依赖网络层防御？→ 缺少应用层纵深防御的设计审查。
3. Why 设计审查未覆盖？→ 架构文档未将"Gateway 信任路径"标注为安全关键路径。
4. Why 未标注？→ 安全架构文档（§7.1 三层防御）侧重于正面描述，缺少攻击树分析。
5. Why 无攻击树分析？→ 项目缺少正式威胁建模（STRIDE/Attack Tree）流程。

**根因陈述**: 安全设计侧重于正常流程描述，缺少攻击者视角的威胁建模，导致信任边界的纵深防御不完整。

### 合规缺失（docs/solutions/ 不存在）
**5-Why**:
1. Why docs/solutions/ 未创建？→ PRD 撰写时规划了该目录但开发和文档是异步进行的。
2. Why 异步开发导致遗漏？→ 缺少"文档交付物 Checklist"与代码交付挂钩的门禁机制。
3. Why 无门禁？→ CI/CD 流程未包含文档完整性检查。
4. Why CI 不检查文档？→ 文档质量归属于"过程资产"而非"交付物"的认知偏差。
5. Why 有此认知偏差？→ CMMI 实施停留在文档编写层面，未嵌入工程流水线。

**根因陈述**: CMMI 实践与工程流水线脱节——Level 5 声明存在于文档中但未通过自动化门禁强制执行。

## 纠正措施（本次修复）

| 编号 | 类别 | 修复内容 | 影响文件 |
|------|------|---------|---------|
| AR-1 | 安全 P0 | Gateway 信任路径从 CIDR IP 白名单升级为 HMAC-SHA256 共享密钥签名校验 | verify-jwt.ts, env.ts, gateway.rs, config.rs, docker-compose.prod.yml |
| CM-1 | 合规 P0 | 创建 docs/solutions/ 经验教训库（含 4 份 CAR 记录 + README 模板） | docs/solutions/* |
| CM-2 | 文档 P1 | README.md DataScope 描述更新至 v3.2 模型 | README.md |
| CM-3 | 文档 P1 | PRD.md 过程性能基线补充可测量数据 | PRD.md |
| RQ-1 | 需求 P1 | 补充 3 项缺失的非功能需求（密码历史/会话并发/数据保留） | PRD.md §6.2 |
| DV-1 | 代码 P2 | authorize/route.ts 分支提取为独立函数 | authorize/route.ts |
| AR-4 | 文档 P2 | access_tokens 表添加"预留表"注释 | schema/auth.ts, DATABASE.md |
| QT-1 | 质量 P2 | API 测试 mock 策略文档化 + 试点迁移 | mock-db.ts, auth-login.test.ts |
| TD-1 | 债务 P2 | 创建 docs/archive/TECH_DEBT.md 技术债务清单 | TECH_DEBT.md |

## 预防措施
- [x] 架构文档补充 Gateway 信任路径的安全假设与防御边界说明
- [x] 生产部署 Checklist 新增 GATEWAY_IPS 必填项
- [ ] 引入定期威胁建模流程（每季度一次 STRIDE 分析）
- [ ] CI 流水线增加文档完整性检查（`docs/solutions/` 目录存在性 + 索引完整性）
- [ ] 建立"文档→代码"一致性自动化校验（如 Zod schema 与 DB schema 的差异检测）

## 效果度量
| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| Gateway 信任路径应用层防御 | X-Forwarded-For 存在性（可伪造） | HMAC-SHA256 密码学签名（不可伪造）+ 60s 时间戳防重放 |
| docs/solutions/ 经验教训条目 | 0 | 4（覆盖 2025-06 至 2026-07） |
| 文档→代码不一致数 | 49（7/9 审计） | 待二次验收 |
| 缺失的非功能需求 | 3 项 | 0（已补充到 PRD） |

## 相关链接
- 关联需求: NFR-SEC-01, H-AUTH-001
- 关联架构约束: R8（三层鉴权体系）
- 本轮审计报告: `docs/spec-alignment-audit-2026-07-09.md`

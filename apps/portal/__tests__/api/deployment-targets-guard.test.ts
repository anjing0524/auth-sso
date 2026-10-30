/**
 * 部署目标守卫：只允许两个生产目标，test/local/ACME staging 不得被写成部署方向。
 *
 * 背景：文档曾把 prod/test/local/acme-staging/Vercel/host 并列，造成“5–6 条部署方向”的误读；
 * 对应决策见 ADR-030。本守卫用可机械检查的文案钉住统一后的口径。
 *
 * @req NFR-SEC-01
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

describe('部署目标收敛（ADR-030）', () => {
  it('根 README 只声明两个生产目标，并明确非部署项', () => {
    const readme = read('README.md');
    expect(readme).toContain('生产部署只有两类目标');
    expect(readme).toContain('唯一日常运维主路径');
    expect(readme).toContain('Vercel 平台');
    expect(readme).toContain('都不是生产部署方向');
    expect(readme).toContain('ADR-030');
  });

  it('docs/docker.md 顶部有部署目标矩阵与非部署分类', () => {
    const docker = read('docs/docker.md');
    expect(docker).toContain('## 部署目标矩阵');
    expect(docker).toContain('自托管生产（P1）');
    expect(docker).toContain('Vercel 平台（P2）');
    expect(docker).toContain('发布验收 / CI');
    expect(docker).toContain('非生产部署');
    expect(docker).toContain('非部署：首次公网签发验证');
  });

  it('集成指南只保留验收栈/自托管生产/Vercel 平台，不把 host 当部署目标', () => {
    const guide = read('docs/INTEGRATION_GUIDE.md');
    expect(guide).toContain('| 自托管生产（P1） |');
    expect(guide).toContain('| Vercel 平台（P2） |');
    expect(guide).not.toContain('| host 本地 |');
  });

  it('ADR-030 存在且记录生产目标决策', () => {
    const adr = read('docs/adr/ADR-030-deployment-targets.md');
    expect(adr).toContain('生产目标 P1：自托管 Docker Compose');
    expect(adr).toContain('生产目标 P2：Vercel 平台托管变体');
    expect(adr).toContain('以下不是部署方向');
  });
});

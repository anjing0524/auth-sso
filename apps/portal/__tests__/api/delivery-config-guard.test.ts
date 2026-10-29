/**
 * 生产交付配置守卫（docker/compose/prod.yml / scripts/docker/deploy.sh / docker/README.md）
 *
 * 2026-10-22 生产链路审计发现并修复的问题，用测试钉住，避免回退：
 * 1. PostgreSQL 端口不得发布到宿主机（应仅 expose）；
 * 2. 首次部署必须先 migrate + seed（db-init 一次性服务），Portal 等它成功后才启动；
 * 3. Redis/Portal 必须有 healthcheck，Gateway 等 Portal healthy；
 * 4. 部署唯一入口 scripts/docker/deploy.sh 必须可执行，并支持 --check/--rollback/--no-build。
 *
 * @req R5
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

describe('生产交付配置', () => {
  const compose = read('docker/compose/prod.yml');

  it('PostgreSQL/Redis 不向宿主机发布端口', () => {
    // postgres 服务块：不允许 ports: - "5432:5432"
    const postgresBlock = compose.slice(compose.indexOf('postgres:'), compose.indexOf('redis:'));
    expect(postgresBlock).not.toMatch(/ports:\s*\n\s*-\s*["']?5432/);
    expect(postgresBlock).toMatch(/expose:\s*\n\s*-\s*["']?5432/);
    expect(compose).not.toMatch(/ports:\s*\n\s*-\s*["']?6379/);
  });

  it('首次部署包含 db-init（migrate + seed），Portal 等它成功', () => {
    expect(compose).toMatch(/db-init:/);
    expect(compose).toMatch(/pnpm --filter @auth-sso\/portal db:migrate && pnpm --filter @auth-sso\/portal db:seed/);
    expect(compose).toMatch(/db-init:\s*\n\s*condition: service_completed_successfully/);
  });

  it('Redis/Portal 有健康检查，Gateway 等 Portal healthy', () => {
    expect(compose).toMatch(/redis-cli -a/);
    expect(compose).toMatch(/\/api\/health/);
    expect(compose).toMatch(/portal:\s*\n\s*condition: service_healthy/);
  });

  it('deploy.sh 可执行且提供校验/回滚/免构建模式', () => {
    const deployPath = join(REPO_ROOT, 'scripts/docker/deploy.sh');
    const mode = statSync(deployPath).mode;
    expect(mode & 0o111, 'deploy.sh 必须可执行').not.toBe(0);
    const deploy = read('scripts/docker/deploy.sh');
    expect(deploy).toMatch(/--check/);
    expect(deploy).toMatch(/--rollback/);
    expect(deploy).toMatch(/--no-build/);
    expect(deploy).toMatch(/\/healthz/);
  });

  it('docker/README.md 把 deploy.sh 作为生产部署唯一入口', () => {
    const dockerDoc = read('docker/README.md');
    expect(dockerDoc).toMatch(/scripts\/docker\/deploy\.sh/);
    expect(dockerDoc).toMatch(/db-init/);
  });
});

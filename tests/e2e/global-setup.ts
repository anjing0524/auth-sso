import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const portalDir = path.join(rootDir, 'apps/portal');
const preloadMock = path.join(portalDir, 'scripts/preload-mock.cjs');
const seedScript = path.join(portalDir, 'scripts/seed.ts');

export default async function globalSetup() {
  if (process.env.E2E_SKIP_SEED === 'true') {
    return;
  }

  await execFileAsync(process.execPath, ['--require', preloadMock, '--import', 'tsx', seedScript], {
    cwd: rootDir,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/auth_sso',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      PORTAL_REDIRECT_URL: 'http://127.0.0.1:4102/api/auth/callback',
    },
  });
}

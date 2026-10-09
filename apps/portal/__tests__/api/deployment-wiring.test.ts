/**
 * Gateway 部署接线契约（读真实部署文件，而非复述假设）
 *
 * ## 为什么需要它
 *
 * `gateway.acme-e2e.toml` / `gateway.acme-staging.toml` / `gateway.toml` /
 * `gateway.docker.toml` **自身不含 `[acme]` 段**——ACME 参数全部由 consumer
 * 经环境变量注入（见各自的 compose/Dockerfile）。若某份部署漏掉
 * `LETSENCRYPT_DOMAIN` 之类的必需变量，网关会在启动校验处 bail：
 *
 * ```text
 * 生产环境必须配置 LETSENCRYPT_DOMAIN 与 LETSENCRYPT_EMAIL
 * ```
 *
 * 而**网关单测侧无法覆盖这一半**：Rust 的 `test_all_shipped_configs_pass_startup_validation`
 * 若凭空构造 ACME 参数，验证的就是编写者的假设而非部署契约（本仓库曾因此出现
 * "单测绿、部署起不来"）。故该契约在此**读真实文件**校验。
 *
 * 同类先例是 `gateway.vercel.toml` 的 `[upstreams.oauth]` 段名错误：它使网关启动
 * 即退出（HTTP 引导监听器不存在），而 CI 只报"未返回 301"，真实原因藏在容器日志里。
 *
 * ## 为什么不做 YAML 解析
 *
 * 依赖一个 YAML 解析器只为了读 compose 的环境变量块，成本高于收益；本文件用
 * 行扫描提取指定 service 的 environment 块——**文本读取是测试的自然接缝**，
 * 而生产代码用的是真实解析器（compose 自身）。
 *
 * @req H-ACME-001
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根：相对本测试文件解析（vitest 的 cwd 与 project root 不一致，勿用 cwd） */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/**
 * 提取 compose 中指定 service 的 environment 键值。
 *
 * 按缩进定位 service 块（`  name:`），再取其 `environment:` 下的 `KEY: value` 行。
 * 值可能为空（如 `KEY:`），空值同样视为"未注入"。
 */
function composeServiceEnv(relPath: string, service: string): Map<string, string> {
  const lines = readRepoFile(relPath).split('\n');
  const start = lines.findIndex((l) => l === `  ${service}:`);
  expect(start, `${relPath} 中未找到 service ${service}`).toBeGreaterThan(-1);

  // service 块在其后第一个同缩进（2 空格）的非空行处结束
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^ {2}\S/.test(line)) {
      end = i;
      break;
    }
  }

  const env = new Map<string, string>();
  let inEnvironment = false;
  for (let i = start; i < end; i += 1) {
    const line = lines[i]!;
    if (/^ {4}environment:\s*$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    // environment 块由更浅缩进的键（如 volumes:）终结
    if (inEnvironment && /^ {4}\S/.test(line)) break;
    if (!inEnvironment) continue;

    const m = /^ {6}([A-Z0-9_]+):\s*(.*)$/.exec(line);
    if (m) env.set(m[1]!, m[2]!.trim());
  }
  return env;
}

/** ACME consumer 必须注入的变量（缺任一即启动被拒） */
const REQUIRED_ACME_ENV = [
  'LETSENCRYPT_DOMAIN',
  'LETSENCRYPT_EMAIL',
  'ACME_DIRECTORY_URL',
  'ACME_STATE_DIR',
] as const;

describe('ACME consumer 的环境注入契约', () => {
  it.each([
    ['docker-compose.test.yml', 'gateway-acme'],
    ['docker-compose.acme-staging.yml', 'gateway'],
  ])('%s 的 %s 注入了全部必需 ACME 变量', (composeFile, service) => {
    const env = composeServiceEnv(composeFile, service);

    for (const key of REQUIRED_ACME_ENV) {
      const value = env.get(key);
      expect(value, `${composeFile} 的 ${service} 未注入 ${key}`).toBeDefined();
      expect(value, `${composeFile} 的 ${service} 的 ${key} 为空值`).not.toBe('');
    }
  });

  it('docker-compose.acme-staging.yml 使用 staging directory（不得误用生产 CA）', () => {
    const env = composeServiceEnv('docker-compose.acme-staging.yml', 'gateway');

    expect(env.get('ACME_DIRECTORY_URL')).toContain('acme-staging-v02');
  });

  it('docker-compose.test.yml 指向 Pebble 且带测试 CA 证书', () => {
    const env = composeServiceEnv('docker-compose.test.yml', 'gateway-acme');

    expect(env.get('ACME_DIRECTORY_URL')).toContain('pebble');
    // Pebble 用私有 CA，必须注入其证书，否则 ACME 客户端不信任
    expect(env.get('ACME_CA_CERT_PATH')).toBeTruthy();
  });

  it('**staging 档位不得注入 ACME_CA_CERT_PATH**（生产环境禁自签 CA）', () => {
    const env = composeServiceEnv('docker-compose.acme-staging.yml', 'gateway');

    // validate_production_security：生产环境禁止配置 ACME_CA_CERT_PATH
    expect(env.get('NODE_ENV')).toBe('production');
    expect(env.has('ACME_CA_CERT_PATH')).toBe(false);
  });
});

describe('平台 TLS consumer（Vercel）的接线契约', () => {
  const dockerfile = readRepoFile('Dockerfile.vercel');

  it('以 --no-default-features 构建（裁剪 self-managed-tls / ACME）', () => {
    expect(dockerfile).toContain('--no-default-features');
  });

  it('运行时注入 NODE_ENV=production 与 EXTERNAL_TLS_TERMINATION=true', () => {
    expect(dockerfile).toMatch(/NODE_ENV=production/);
    expect(dockerfile).toMatch(/EXTERNAL_TLS_TERMINATION=true/);
  });

  it('挂载 gateway.vercel.toml 作为运行时配置', () => {
    expect(dockerfile).toContain('apps/gateway/gateway.vercel.toml');
  });

  it('**不得注入 ACME 变量**（该档位禁用 ACME，同时配置会 bail）', () => {
    for (const key of REQUIRED_ACME_ENV) {
      expect(dockerfile, `Dockerfile.vercel 不应出现 ${key}`).not.toContain(key);
    }
  });

  it('gateway.vercel.toml 自身声明 external_tls_termination（配置自足，不靠 ENV）', () => {
    const toml = readRepoFile('apps/gateway/gateway.vercel.toml');

    expect(toml).toMatch(/external_tls_termination\s*=\s*true/);
  });
});

describe('ACME 依赖方与配置段的一致性', () => {
  it('依赖 env 注入 ACME 的配置，自身**不含** [acme] 段（避免双真相源）', () => {
    for (const tomlPath of [
      'apps/gateway/gateway.toml',
      'apps/gateway/gateway.docker.toml',
      'apps/gateway/gateway.acme-e2e.toml',
      'apps/gateway/gateway.acme-staging.toml',
    ]) {
      const toml = readRepoFile(tomlPath);
      expect(toml, `${tomlPath} 不应含 [acme] 段（参数由 env 注入）`).not.toMatch(
        /^\[acme\]/m,
      );
    }
  });
});

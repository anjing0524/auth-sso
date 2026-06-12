import fs from 'fs';
import path from 'path';

try {
  // 从 portal 目录加载 .env.local
  const envPath = path.resolve(process.cwd(), 'apps/portal/.env.local');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const firstEquals = trimmed.indexOf('=');
        if (firstEquals !== -1) {
          const key = trimmed.slice(0, firstEquals).trim();
          let value = trimmed.slice(firstEquals + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (key && !(key in process.env)) {
            process.env[key] = value;
          }
        }
      }
    });
    console.log('✨ [load-env] Loaded environment from apps/portal/.env.local');
  }
} catch (error) {
  console.error('[load-env] Failed to load environment:', error);
}

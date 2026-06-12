import fs from 'fs';
import path from 'path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const firstEquals = trimmed.indexOf('=');
        if (firstEquals !== -1) {
          const key = trimmed.slice(0, firstEquals).trim();
          let value = trimmed.slice(firstEquals + 1).trim();
          // 移除包裹的引号
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (key && !(key in process.env)) {
            process.env[key] = value;
          }
        }
      }
    });
    console.log('✨ [load-env] Loaded environment variables from .env.local');
  } else {
    console.log('⚠️ [load-env] .env.local not found, relying on system environment variables');
  }
} catch (error) {
  console.error('❌ [load-env] Failed to load environment:', error);
}

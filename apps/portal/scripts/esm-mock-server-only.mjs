import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hooksUrl = new URL(resolve(__dirname, './server-only-resolve-hooks.mjs'), import.meta.url);
register(hooksUrl.href, import.meta.url);

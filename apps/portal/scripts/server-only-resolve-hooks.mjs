import { fileURLToPath } from 'node:url';
import { resolve as pathResolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_URL = pathResolve(__dirname, './server-only-mock-shim.cjs');

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === 'server-only') {
    return { url: new URL(MOCK_URL, import.meta.url).href, shortCircuit: true };
  }
  return defaultResolve(specifier, context);
}

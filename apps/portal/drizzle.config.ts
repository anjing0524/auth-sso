import { createDrizzleConfig } from '../../drizzle.base';
import './scripts/load-env';

export default createDrizzleConfig({
  schema: './src/db/schema/*.ts',
  out: './drizzle',
});
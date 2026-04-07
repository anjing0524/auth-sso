import 'dotenv/config';
import * as schema from '../src/db/schema';

console.log('Keys of schema.oauthAccessTokens:', Object.keys(schema.oauthAccessTokens));
const keys = Object.keys(schema.oauthAccessTokens);
if (keys.includes('_')) {
  const table = schema.oauthAccessTokens as unknown as { _: { columns: Record<string, unknown> } };
  console.log('Columns inside _:', Object.keys(table._));
  console.log('Columns inside _.columns:', Object.keys(table._.columns));
}

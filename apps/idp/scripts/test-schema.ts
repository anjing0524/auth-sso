import 'dotenv/config';
import { db } from '../src/db';
import * as schema from '../src/db/schema';

console.log('Keys of schema.oauthAccessTokens:', Object.keys(schema.oauthAccessTokens));
const keys = Object.keys(schema.oauthAccessTokens);
if (keys.includes('_')) {
  console.log('Columns inside _:', Object.keys((schema.oauthAccessTokens as any)._));
  console.log('Columns inside _.columns:', Object.keys((schema.oauthAccessTokens as any)._.columns));
}

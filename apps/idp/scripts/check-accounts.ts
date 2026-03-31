import 'dotenv/config';
import { db } from '../src/db';
import { users, accounts } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function check() {
  const user = await db.select().from(users).where(eq(users.email, 'admin@example.com'));
  console.log('User:', JSON.stringify(user[0], null, 2));

  if (user[0]) {
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user[0].id));
    console.log('\nAccounts for this user:', JSON.stringify(userAccounts, null, 2));
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
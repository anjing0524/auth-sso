import 'dotenv/config';
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function check() {
  const result = await db.select({
    id: users.id,
    email: users.email,
    password: users.password,
    passwordHash: users.passwordHash
  }).from(users).where(eq(users.email, 'admin@example.com'));

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
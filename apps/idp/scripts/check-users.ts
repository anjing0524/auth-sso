import { db } from '../src/db';

async function main() {
  const users = await db.query.users.findMany();
  console.log('Existing users:', JSON.stringify(users, null, 2));
  process.exit(0);
}

main();

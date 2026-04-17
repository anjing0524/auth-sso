import { db } from '../src/db';

async function main() {
  const accounts = await db.query.accounts.findMany();
  console.log('Existing accounts:', JSON.stringify(accounts, null, 2));
  process.exit(0);
}

main();

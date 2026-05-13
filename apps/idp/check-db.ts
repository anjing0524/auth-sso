import { db } from './src/db';
import * as schema from './src/db/schema';
import { eq } from 'drizzle-orm';

async function run() {
  const portal = await db.query.clients.findFirst({
    where: eq(schema.clients.clientId, 'portal')
  });
  console.log("Portal Client:", portal);
  process.exit(0);
}
run();

import { db } from '../src/db';
import bcrypt from 'bcryptjs';

async function main() {
  const admin = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.username, 'admin')
  });

  if (!admin || !admin.password) {
    console.log('Admin not found or no password');
    process.exit(1);
  }

  const testPassword = 'Admin@123456';
  const match = await bcrypt.compare(testPassword, admin.password);
  
  console.log('Password match test:', match);
  console.log('Database password hash:', admin.password);
  
  process.exit(0);
}

main();

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/auth_sso',
});
async function run() {
  const res = await pool.query("SELECT client_id, skip_consent FROM clients WHERE client_id = 'portal'");
  console.log("Portal Client:", res.rows[0]);
  pool.end();
}
run();
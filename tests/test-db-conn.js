const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/auth_sso_idp"
});
client.connect()
  .then(() => {
    console.log('Connected to localhost');
    process.exit(0);
  })
  .catch(err => {
    console.error('Failed to connect to localhost:', err.message);
    const client2 = new Client({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/auth_sso_idp"
    });
    client2.connect()
      .then(() => {
        console.log('Connected to 127.0.0.1');
        process.exit(0);
      })
      .catch(err2 => {
        console.error('Failed to connect to 127.0.0.1:', err2.message);
        process.exit(1);
      });
  });

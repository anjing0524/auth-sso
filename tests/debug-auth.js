const { TestRunner, config } = require('./utils');

async function debug() {
  const runner = new TestRunner({ record: () => {} });
  const http = runner.http;
  
  console.log('1. Initializing OAuth from Portal...');
  const init = await http.get(`${config.PORTAL_URL}/api/auth/login`);
  const authUrl = init.headers['location'];
  console.log('Auth URL:', authUrl);
  
  console.log('2. Logging into IdP...');
  const idpCookies = await runner.loginIdP();
  
  console.log('3. Sending Authorization request...');
  const authRes = await http.get(authUrl, {
    Cookie: idpCookies.getHeader()
  });
  
  console.log('Status:', authRes.status);
  console.log('Content-Type:', authRes.headers['content-type']);
  console.log('Body Preview:', typeof authRes.body === 'string' ? authRes.body.substring(0, 500) : JSON.stringify(authRes.body));
  
  process.exit(0);
}

debug();

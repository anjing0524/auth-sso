const { TestRunner, config } = require('./utils');
async function run() {
  const runner = new TestRunner();
  const idpCookies = await runner.loginIdP();
  console.log("Logged into IdP. Cookies:", idpCookies.getHeader());
  
  const loginInit = await runner.http.get(`${config.PORTAL_URL}/api/auth/login`);
  console.log("Portal login URL:", loginInit.headers['location']);
  
  const authRes = await runner.http.get(loginInit.headers['location'], {
    Cookie: idpCookies.getHeader()
  });
  console.log("Auth Response Status:", authRes.status);
  console.log("Auth Response Body:", typeof authRes.body === 'string' ? authRes.body : JSON.stringify(authRes.body));
  console.log("Auth Response Headers:", authRes.headers);
}
run().catch(console.error);

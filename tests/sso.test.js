/**
 * SSO测试 - SSO Integration Tests
 * 验证单点登录和单点登出功能
 */

const { TestReporter, TestRunner, config, CookieManager } = require('./utils');

/**
 * 运行SSO测试 - Run SSO tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  // 5.1 单点登录测试

  // SSO-001: Portal 登录后 Demo 免登
  await runner.run('SSO-001', 'Portal 登录后 Demo App 免登', async () => {
    // 1. 登录 IdP
    const idpCookies = await runner.loginIdP();
    
    // 2. 登录 Portal
    const portalCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    assert.exists(portalCookies.get('portal_session_id') || portalCookies.get('better-auth.session_token'), 'Portal 应登录成功');
    
    // 3. 访问 Demo App 登录入口 (应利用 IdP Session 自动重定向回来)
    const demoLoginInit = await http.get(`${config.DEMO_APP_URL}/api/auth/login`);
    const demoAuthUrl = demoLoginInit.headers['location'];
    const demoStateCookie = new CookieManager();
    demoStateCookie.extract(demoLoginInit.cookies);
    
    // 4. 发起授权请求 (带上 IdP Cookies)
    const demoAuthRes = await http.get(demoAuthUrl, {
      Cookie: idpCookies.getHeader()
    });
    
    let demoCallbackUrl;
    if (demoAuthRes.status === 200) {
      if (demoAuthRes.body && demoAuthRes.body.redirect && demoAuthRes.body.url) {
        demoCallbackUrl = demoAuthRes.body.url;
      } else {
        const bodyStr = typeof demoAuthRes.body === 'string' ? demoAuthRes.body : JSON.stringify(demoAuthRes.body);
        const consentCodeMatch = bodyStr.match(/consent_code: '([^']+)'/);
        if (consentCodeMatch) {
          const consentRes = await http.post(`${config.IDP_URL}/api/auth/oauth2/consent`, {
            accept: true,
            consent_code: consentCodeMatch[1],
            scopes: "openid profile email offline_access"
          }, { Cookie: idpCookies.getHeader() });
          demoCallbackUrl = consentRes.body.redirectURI;
        }
      }
    } else if (demoAuthRes.status === 302 || demoAuthRes.status === 307) {
      demoCallbackUrl = demoAuthRes.headers['location'];
    }

    assert.exists(demoCallbackUrl, 'Demo 授权应成功获取回调URL');
    
    // 5. 执行回调到 Demo App
    const demoCallbackRes = await http.get(demoCallbackUrl, {
      Cookie: demoStateCookie.getHeader()
    });
    
    assert.equal(demoCallbackRes.status === 302 || demoCallbackRes.status === 307, true, 'Demo 回调应成功');
    const demoAppCookies = new CookieManager();
    demoAppCookies.extract(demoCallbackRes.cookies);
    
    // Demo App 使用的 cookie 名称是 demo_session
    assert.exists(demoAppCookies.get('demo_session') || demoAppCookies.get('better-auth.session_token'), 'Demo App 应实现免登');
  });

  // 5.2 单点登出测试
  
  // SSO-010: Portal 登出后 Demo 也失效
  await runner.run('SSO-010', 'Portal 登出后全线失效', async () => {
    // 1. 登录 IdP
    const idpCookies = await runner.loginIdP();
    
    // 2. 获取 Portal Session (使用同一个 IdP Session)
    const portalCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal', idpCookies);
    
    // 3. 执行 Portal 登出
    const logoutRes = await http.post(`${config.PORTAL_URL}/api/auth/logout`, {}, {
      Cookie: portalCookies.getHeader()
    });
    assert.status(logoutRes.status, 200, 'Portal 登出接口应返回 200');
    
    // 4. 检查 IdP Session
    // 再次发起授权，如果 IdP Session 已销毁，应重定向到登录页或返回登录页
    const authorizeUrl = new URL(`${config.IDP_URL}/api/auth/oauth2/authorize`);
    authorizeUrl.searchParams.set('client_id', 'demo-app');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', `${config.DEMO_APP_URL}/api/auth/callback`);
    authorizeUrl.searchParams.set('scope', 'openid profile email');
    
    const reAuthRes = await http.get(authorizeUrl.toString(), {
      Cookie: idpCookies.getHeader()
    });
    
    const isLoggedOut = 
        reAuthRes.status === 200 || 
        (reAuthRes.status >= 300 && reAuthRes.status < 400 && reAuthRes.headers['location']?.includes('sign-in'));
    
    assert.equal(isLoggedOut, true, '登出后应重定向到登录页或需要重新登录');
  });
}

module.exports = { run };

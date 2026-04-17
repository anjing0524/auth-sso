/**
 * 测试工具类 - Test Utilities
 * 提供测试辅助功能
 */

const config = require('./config');
const crypto = require('crypto');

/**
 * 测试结果收集器 - Test result collector
 */
class TestReporter {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  /**
   * 记录测试结果 - Record test result
   * @param {string} testId - 测试ID
   * @param {string} testName - 测试名称
   * @param {string} status - 状态 (PASS/FAIL/SKIP)
   * @param {string} message - 消息
   * @param {number} duration - 持续时间(ms)
   */
  record(testId, testName, status, message = '', duration = 0) {
    this.results.push({
      testId,
      testName,
      status,
      message,
      duration,
      timestamp: new Date().toISOString()
    });

    if (status === 'PASS') this.passed++;
    else if (status === 'FAIL') this.failed++;
    else this.skipped++;
  }

  /**
   * 打印测试报告 - Print test report
   */
  printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('测试报告 - Test Report');
    console.log('='.repeat(60));

    // 打印每个测试结果
    this.results.forEach(result => {
      const statusIcon = result.status === 'PASS' ? '✓' :
                         result.status === 'FAIL' ? '✗' : '○';
      const durationStr = result.duration ? ` (${result.duration}ms)` : '';
      console.log(`${statusIcon} ${result.testId}: ${result.testName}${durationStr}`);
      if (result.message && result.status === 'FAIL') {
        console.log(`  Error: ${result.message}`);
      }
    });

    // 打印汇总
    console.log('\n' + '-'.repeat(60));
    console.log(`总计: ${this.results.length} | 通过: ${this.passed} | 失败: ${this.failed} | 跳过: ${this.skipped}`);
    console.log(`通过率: ${this.results.length > 0 ? ((this.passed / this.results.length) * 100).toFixed(1) : 0}%`);
    console.log('='.repeat(60) + '\n');

    return this.failed === 0;
  }

  /**
   * 生成JSON报告 - Generate JSON report
   */
  toJSON() {
    return {
      summary: {
        total: this.results.length,
        passed: this.passed,
        failed: this.failed,
        skipped: this.skipped,
        passRate: this.results.length > 0 ? ((this.passed / this.results.length) * 100).toFixed(1) : 0
      },
      results: this.results,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * HTTP请求辅助类 - HTTP request helper
 */
class HttpClient {
  /**
   * 发送GET请求 - Send GET request
   * @param {string} url - URL
   * @param {object} headers - Headers
   * @returns {Promise<{status, headers, body, duration, cookies}>}
   */
  async get(url, headers = {}) {
    const start = Date.now();
    try {
      const urlObj = new URL(url);
      const defaultOrigin = urlObj.port === '4001' ? config.IDP_URL : config.PORTAL_URL;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 
          'Origin': defaultOrigin,
          ...headers 
        },
        redirect: 'manual' // 不自动跟随重定向
      });
      const body = await this.parseBody(response);
      return {
        status: response.status,
        headers: this.headersToObject(response.headers),
        body,
        duration: Date.now() - start,
        cookies: this.extractCookies(response.headers)
      };
    } catch (error) {
      throw new Error(`GET ${url} failed: ${error.message}`);
    }
  }

  /**
   * 发送POST请求 - Send POST request
   * @param {string} url - URL
   * @param {object|string} body - Body
   * @param {object} headers - Headers
   * @returns {Promise<{status, headers, body, duration, cookies}>}
   */
  async post(url, body = {}, headers = {}) {
    const start = Date.now();
    try {
      const isForm = headers['Content-Type'] === 'application/x-www-form-urlencoded';
      const urlObj = new URL(url);
      const defaultOrigin = urlObj.port === '4001' ? config.IDP_URL : config.PORTAL_URL;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': defaultOrigin,
          ...headers
        },
        body: typeof body === 'string' ? body : (isForm ? body.toString() : JSON.stringify(body)),
        redirect: 'manual'
      });
      const responseBody = await this.parseBody(response);
      return {
        status: response.status,
        headers: this.headersToObject(response.headers),
        body: responseBody,
        duration: Date.now() - start,
        cookies: this.extractCookies(response.headers)
      };
    } catch (error) {
      throw new Error(`POST ${url} failed: ${error.message}`);
    }
  }

  async parseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        const body = await response.json();
        // console.log(`DEBUG JSON Body:`, JSON.stringify(body).substring(0, 100));
        return body;
      }
      const text = await response.text();
      // console.log(`DEBUG Text Body:`, text.substring(0, 100));
      return text;
    } catch (e) {
      return null;
    }
  }

  /**
   * Headers转对象 - Headers to object
   */
  headersToObject(headers) {
    const obj = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  /**
   * 提取Cookies - Extract cookies
   */
  extractCookies(headers) {
    const cookies = [];
    
    // 优先使用标准 API
    if (typeof headers.getSetCookie === 'function') {
      const setCookie = headers.getSetCookie();
      if (setCookie && setCookie.length > 0) {
        cookies.push(...setCookie);
      }
    }
    
    // 备选方案：手动解析 header
    if (cookies.length === 0) {
      const rawSetCookie = headers.get('set-cookie');
      if (rawSetCookie) {
        // fetch 可能会将多个 set-cookie 合并成逗号分隔的字符串，这在处理包含日期的 Cookie 时非常棘手
        // 这里的逻辑需要非常小心，或者依赖 getSetCookie
        const parts = rawSetCookie.split(/,(?=\s*[a-zA-Z0-9_]+=)/);
        cookies.push(...parts);
      }
    }
    
    return cookies;
  }
}

/**
 * 断言工具类 - Assertion utilities
 */
class Assert {
  /**
   * 断言相等 - Assert equal
   * @param {*} actual - 实际值
   * @param {*} expected - 预期值
   * @param {string} message - 消息
   */
  equal(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`${message}: Expected ${expected}, got ${actual}`);
    }
  }

  /**
   * 断言包含 - Assert includes
   * @param {*} container - 容器
   * @param {*} value - 值
   * @param {string} message - 消息
   */
  includes(container, value, message = '') {
    if (!container || !container.includes(value)) {
      throw new Error(`${message}: Expected ${container} to include ${value}`);
    }
  }

  /**
   * 断言状态码 - Assert status code
   * @param {number} actual - 实际状态码
   * @param {number} expected - 预期状态码
   * @param {string} message - 消息
   */
  status(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`${message}: Expected status ${expected}, got ${actual}`);
    }
  }

  /**
   * 断言重定向 - Assert redirect
   * @param {number} status - 状态码
   * @param {string} location - 重定向地址
   * @param {string} expectedLocation - 预期重定向地址（部分匹配）
   * @param {string} message - 消息
   */
  redirect(status, location, expectedLocation, message = '') {
    if (status !== 302 && status !== 301 && status !== 307 && status !== 308) {
      throw new Error(`${message}: Expected redirect status, got ${status}`);
    }
    if (!location || !location.includes(expectedLocation)) {
      throw new Error(`${message}: Expected redirect to ${expectedLocation}, got ${location}`);
    }
  }

  /**
   * 断言响应时间 - Assert response time
   * @param {number} actual - 实际时间
   * @param {number} threshold - 阈值
   * @param {string} message - 消息
   */
  responseTime(actual, threshold, message = '') {
    if (actual > threshold) {
      throw new Error(`${message}: Response time ${actual}ms exceeds threshold ${threshold}ms`);
    }
  }

  /**
   * 断言存在 - Assert exists
   * @param {*} value - 值
   * @param {string} message - 消息
   */
  exists(value, message = '') {
    if (value === undefined || value === null) {
      throw new Error(`${message}: Value should exist`);
    }
  }

  /**
   * 断言类型 - Assert type
   * @param {*} value - 值
   * @param {string} type - 类型
   * @param {string} message - 消息
   */
  type(value, type, message = '') {
    if (typeof value !== type && !(type === 'array' && Array.isArray(value))) {
      throw new Error(`${message}: Expected type ${type}, got ${typeof value}`);
    }
  }
}

/**
 * Cookie管理器 - Cookie manager
 */
class CookieManager {
  constructor() {
    this.cookies = {};
  }

  /**
   * 从响应或Cookie列表中提取Cookie - Extract cookies
   * @param {object|string[]} source - 响应headers或Cookie数组
   */
  extract(source) {
    let cookies = [];
    if (Array.isArray(source)) {
      cookies = source;
    } else if (source && source['set-cookie']) {
      cookies = Array.isArray(source['set-cookie']) ? source['set-cookie'] : [source['set-cookie']];
    }

    cookies.forEach(cookie => {
      const parts = cookie.split(';')[0].split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts[1].trim();
        this.cookies[name] = value;
      }
    });
  }

  /**
   * 获取Cookie header字符串 - Get cookie header string
   * @returns {string}
   */
  getHeader() {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * 获取特定Cookie - Get specific cookie
   * @param {string} name - Cookie名称
   * @returns {string|undefined}
   */
  get(name) {
    return this.cookies[name];
  }

  /**
   * 清除所有Cookie - Clear all cookies
   */
  clear() {
    this.cookies = {};
  }
}

/**
 * 测试运行器 - Test runner
 */
class TestRunner {
  constructor(reporter) {
    this.reporter = reporter;
    this.http = new HttpClient();
    this.assert = new Assert();
    this.cookies = new CookieManager();
  }

  /**
   * 运行单个测试 - Run single test
   * @param {string} testId - 测试ID
   * @param {string} testName - 测试名称
   * @param {function} testFn - 测试函数
   */
  async run(testId, testName, testFn) {
    const start = Date.now();
    try {
      await testFn();
      const duration = Date.now() - start;
      this.reporter.record(testId, testName, 'PASS', '', duration);
    } catch (error) {
      const duration = Date.now() - start;
      this.reporter.record(testId, testName, 'FAIL', error.message, duration);
    }
  }

  /**
   * 登录到IdP - Login to IdP
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   * @returns {Promise<Record<string, string>>} Session cookies
   */
  async loginIdP(email = config.TEST_USER.email, password = config.TEST_USER.password) {
    const response = await this.http.post(`${config.IDP_URL}/api/auth/sign-in/email`, {
      email,
      password
    });

    if (response.status !== 200) {
      throw new Error(`IdP Login failed: ${response.status}`);
    }

    const cookies = new CookieManager();
    cookies.extract(response.cookies);
    return cookies;
  }

  /**
   * 执行完整的OAuth登录流程 - Perform full OAuth flow
   * @param {string} appUrl - 应用URL (Portal or Demo)
   * @param {string} clientId - Client ID
   * @param {CookieManager} existingIdpCookies - 可选的现有 IdP Cookies
   * @returns {Promise<CookieManager>} App session cookies
   */
  async performOAuthFlow(appUrl, clientId, existingIdpCookies = null) {
    // 1. 获取Portal登录重定向
    const loginInit = await this.http.get(`${appUrl}/api/auth/login`);
    if (loginInit.status !== 302 && loginInit.status !== 307) {
      throw new Error(`OAuth Init failed: ${loginInit.status}`);
    }

    const authUrl = loginInit.headers['location'];
    if (!authUrl) {
      throw new Error(`No Location header in OAuth Init response from ${appUrl}/api/auth/login`);
    }
    // console.log(`DEBUG: OAuth Auth URL: ${authUrl}`);
    
    const portalCookies = new CookieManager();
    portalCookies.extract(loginInit.cookies);

    // 2. 登录IdP (如果没有提供)
    const idpCookies = existingIdpCookies || await this.loginIdP();

    // 3. 执行授权请求
    const authRes = await this.http.get(authUrl, {
      Cookie: idpCookies.getHeader()
    });

    let callbackUrl;

    if (authRes.status === 302 || authRes.status === 307) {
      callbackUrl = authRes.headers['location'];
    } else if (authRes.status === 200) {
      const body = authRes.body;
      
      // 情况1: 直接返回JSON重定向 (当 skipConsent: true 时)
      if (body && body.redirect && body.url) {
        callbackUrl = body.url;
      } 
      // 情况2: 返回 Consent HTML 页面
      else {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        if (bodyStr && bodyStr.includes('consent_code')) {
          const consentCodeMatch = bodyStr.match(/consent_code: '([^']+)'/);
          if (consentCodeMatch) {
            // console.log(`DEBUG: Found consent_code: ${consentCodeMatch[1]}`);
            const consentRes = await this.http.post(`${config.IDP_URL}/api/auth/oauth2/consent`, {
              accept: true,
              consent_code: consentCodeMatch[1],
              scopes: "openid profile email offline_access"
            }, {
              Cookie: idpCookies.getHeader()
            });
            
            // console.log(`DEBUG: Consent POST response:`, JSON.stringify(consentRes.body));
            
            if (consentRes.status === 200 && consentRes.body && (consentRes.body.redirectURI || consentRes.body.url)) {
              callbackUrl = consentRes.body.redirectURI || consentRes.body.url;
            } else {
              console.log(`DEBUG: Consent POST failed or missing redirectURI. Status: ${consentRes.status}, Body:`, JSON.stringify(consentRes.body));
            }
          }
        }
      }
    }

    if (!callbackUrl) {
      throw new Error(`OAuth Authorization failed to get callback URL. Status: ${authRes.status}, Body: ${JSON.stringify(authRes.body)}`);
    }

    // 4. 执行回调到App
    const callbackRes = await this.http.get(callbackUrl, {
      Cookie: portalCookies.getHeader()
    });

    // console.log(`DEBUG: Callback Response Status: ${callbackRes.status}`);
    // console.log(`DEBUG: Callback Response Cookies:`, JSON.stringify(callbackRes.cookies));

    if (callbackRes.status !== 302 && callbackRes.status !== 307 && callbackRes.status !== 200) {
      throw new Error(`OAuth Callback failed with status ${callbackRes.status}`);
    }

    // 提取最终的应用Session Cookie
    const finalCookies = new CookieManager();
    finalCookies.extract(portalCookies.cookies); // 包含state cookie
    finalCookies.extract(callbackRes.cookies); // 包含session cookie

    const hasSession = Object.keys(finalCookies.cookies).some(name => 
      name.includes('session') || name.includes('auth') || name.includes('token')
    );
    if (!hasSession) {
       console.log(`DEBUG: NO SESSION COOKIE FOUND in callback response. Headers:`, JSON.stringify(callbackRes.headers));
    }

    // 如果是200，可能是由于跳转被拦截，但实际上已经设置了Cookie
    return finalCookies;

  }

  /**
   * 生成PKCE参数 - Generate PKCE parameters
   */
  generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  /**
   * 等待服务启动 - Wait for service to start
   * @param {string} url - 服务URL
   * @param {number} timeout - 超时时间(ms)
   */
  async waitForService(url, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const response = await fetch(url);
        if (response.status < 500) {
          return true;
        }
      } catch (error) {
        // 服务未启动，继续等待
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Service ${url} not available after ${timeout}ms`);
  }
}

module.exports = {
  TestReporter,
  HttpClient,
  Assert,
  CookieManager,
  TestRunner,
  config
};
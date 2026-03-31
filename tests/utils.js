/**
 * 测试工具类 - Test Utilities
 * 提供测试辅助功能
 */

const config = require('./config');

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
    console.log(`通过率: ${((this.passed / this.results.length) * 100).toFixed(1)}%`);
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
        passRate: ((this.passed / this.results.length) * 100).toFixed(1)
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
   * @returns {Promise<{status, headers, body}>}
   */
  async get(url, headers = {}) {
    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { ...headers },
        redirect: 'manual' // 不自动跟随重定向
      });
      const body = await this.parseBody(response);
      return {
        status: response.status,
        headers: this.headersToObject(response.headers),
        body,
        duration: Date.now() - start
      };
    } catch (error) {
      throw new Error(`GET ${url} failed: ${error.message}`);
    }
  }

  /**
   * 发送POST请求 - Send POST request
   * @param {string} url - URL
   * @param {object} body - Body
   * @param {object} headers - Headers
   * @returns {Promise<{status, headers, body}>}
   */
  async post(url, body = {}, headers = {}) {
    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body),
        redirect: 'manual'
      });
      const responseBody = await this.parseBody(response);
      return {
        status: response.status,
        headers: this.headersToObject(response.headers),
        body: responseBody,
        duration: Date.now() - start
      };
    } catch (error) {
      throw new Error(`POST ${url} failed: ${error.message}`);
    }
  }

  /**
   * 解析响应体 - Parse response body
   */
  async parseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
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
    if (!container.includes(value)) {
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
    if (status !== 302 && status !== 301) {
      throw new Error(`${message}: Expected redirect status, got ${status}`);
    }
    if (!location.includes(expectedLocation)) {
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
    if (typeof value !== type) {
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
   * 从响应中提取Cookie - Extract cookies from response
   * @param {object} headers - 响应headers
   */
  extract(headers) {
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      // 解析set-cookie header
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      cookies.forEach(cookie => {
        const parts = cookie.split(';')[0].split('=');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const value = parts[1].trim();
          this.cookies[name] = value;
        }
      });
    }
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
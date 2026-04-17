/**
 * 性能测试 - Performance Tests
 * 验证认证流程各阶段的响应时间
 */

const { TestReporter, TestRunner, config, CookieManager } = require('./utils');

/**
 * 运行性能测试 - Run performance tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  // PERF-001: 登录响应时间
  await runner.run('PERF-001', '登录初始跳转性能', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    assert.responseTime(response.duration, config.PERFORMANCE_THRESHOLD.loginResponseTime, '登录初始跳转应在阈值内');
  });

  // PERF-002: 完整 OAuth 交换性能
  await runner.run('PERF-002', '完整 OAuth 流程性能', async () => {
    const start = Date.now();
    await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    const duration = Date.now() - start;
    
    assert.responseTime(duration, 10000, '完整认证流程应在10秒内完成');
  });

  // PERF-003: Session 查询时间
  await runner.run('PERF-003', 'Session 查询性能', async () => {
    // 先获取一个有效Session
    const sessionCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    
    // 测量API响应（包含Session查询）
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: sessionCookies.getHeader()
    });
    
    assert.responseTime(response.duration, config.PERFORMANCE_THRESHOLD.apiResponseTime, 'API响应应在阈值内');
  });
}

module.exports = { run };

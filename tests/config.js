/**
 * 测试配置 - Test Configuration
 * 定义所有测试环境参数
 */

module.exports = {
  // 服务端口配置 - Service port configuration
  PORTAL_URL: 'http://127.0.0.1:4100',
  IDP_URL: 'http://127.0.0.1:4101',
  DEMO_APP_URL: 'http://127.0.0.1:4102',


  // 测试用户配置 - Test user configuration
  TEST_USER: {
    username: 'admin',
    password: 'Admin@123456',
    email: 'admin@example.com'
  },

  // 测试Client配置 - Test client configuration
  TEST_CLIENTS: {
    portal: {
      clientId: 'portal',
      clientSecret: 'portal-secret',
      redirectUri: 'http://localhost:4100/auth/callback'
    },
    demo: {
      clientId: 'demo-app',
      clientSecret: 'demo-app-secret',
      redirectUri: 'http://localhost:4102/auth/callback'
    }
  },

  // Session配置 - Session configuration
  SESSION_IDLE_TIMEOUT_MS: 30 * 60 * 1000, // 30分钟
  SESSION_ABSOLUTE_TIMEOUT_MS: 7 * 24 * 60 * 60 * 1000, // 7天

  // Redis配置 - Redis configuration
  REDIS_URL: 'redis://localhost:6379',

  // 数据库配置 - Database configuration
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/auth_sso',

  // 测试超时配置 - Test timeout configuration
  TEST_TIMEOUT_MS: 30000,

  // 性能阈值配置 - Performance threshold configuration
  PERFORMANCE_THRESHOLD: {
    loginResponseTime: 2000, // 登录响应时间 < 2秒
    tokenExchangeTime: 500, // Token交换时间 < 500ms
    sessionQueryTime: 50, // Session查询时间 < 50ms
    apiResponseTime: 500 // API响应时间 < 500ms
  }
};
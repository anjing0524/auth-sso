/**
 * 测试运行器 - Test Runner
 * 运行所有自动化测试并生成报告
 */

const { TestReporter } = require('./utils');
const fs = require('fs');
const path = require('path');

// 测试文件列表 - Test file list
const DEFAULT_TEST_FILES = ['detailed-logic.test.js',
  'tdd-prd-all.test.js',
  'department.test.js',
  'smoke.test.js',
  'auth.test.js',
  'permission.test.js',
  'session.test.js',
  'security.test.js',
  'sso.test.js',
  'performance.test.js',
  'business.test.js',
  'data-scope.test.js',
  'auth-security.test.js'
];

// 从命令行获取要运行的文件
const args = process.argv.slice(2);
const TEST_FILES = args.length > 0 ? args : DEFAULT_TEST_FILES;

/**
 * 运行所有测试 - Run all tests
 */
async function runAllTests() {
  console.log('\n🚀 Auth-SSO 自动化测试套件启动\n');
  if (args.length > 0) {
    console.log('🎯 运行特定测试文件:', args.join(', '));
  }
  console.log('测试时间:', new Date().toISOString());

  const totalReporter = new TestReporter();

  for (const testFile of TEST_FILES) {
    const filePath = path.join(__dirname, testFile);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  测试文件不存在: ${testFile}`);
      continue;
    }

    console.log(`\n📋 运行测试: ${testFile}\n`);

    try {
      // 动态加载测试模块
      const testModule = require(filePath);

      // 如果模块有run函数，执行它
      if (testModule.run) {
        await testModule.run(totalReporter);
      }
    } catch (error) {
      console.error(`❌ 测试文件执行失败: ${testFile}`);
      console.error(error.message);
    }
  }

  // 打印最终报告
  const success = totalReporter.printReport();

  // 保存JSON报告
  const reportPath = path.join(__dirname, 'test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(totalReporter.toJSON(), null, 2));
  console.log(`📄 测试报告已保存到: ${reportPath}`);

  // 返回退出码
  process.exit(success ? 0 : 1);
}

// 执行测试
runAllTests().catch(error => {
  console.error('测试运行失败:', error);
  process.exit(1);
});
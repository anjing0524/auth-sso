import dotenv from 'dotenv';
import path from 'path';

// 显式加载 apps/idp/.env.local 中的测试环境变量，支持在 tsx standalone 环境下直接运行脚本而无 hoisting 竞态
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

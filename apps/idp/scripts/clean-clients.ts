import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';

/**
 * 生产环境客户端域名洗涤与安全加固脚本
 * 
 * 作用：
 * 自动识别 clients 表中所有的本地开发重定向 URL (http://localhost:*) 
 * 及指定老域名，全局批量清洗并替换为生产环境下真实的互联网安全 HTTPS 域名。
 */
async function cleanClients() {
  console.log('🔄 开始执行生产环境客户端域名洗涤与清洗...');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ 错误：环境变量 DATABASE_URL 未设置，请配置后重试。');
    process.exit(1);
  }

  // 判定是否是 Vercel Neon 或云端带 SSL 的数据库，是则追加 ssl: require
  const needsSsl = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require');
  const client = postgres(connectionString, needsSsl ? { ssl: 'require' } : {});
  const db = drizzle(client, { schema });

  // 1. 获取要替换的目标公网域名 (例如 https://portal.yourdomain.com)
  const newDomain = process.env.NEW_DOMAIN;
  if (!newDomain) {
    console.warn('⚠️ 警告：未检测到环境变量 NEW_DOMAIN。');
    console.warn('   如果需要将客户端的 localhost 开发端口清洗为公网域名，请配置 NEW_DOMAIN 环境变量。');
    console.warn('   例如：NEW_DOMAIN=https://portal.yourdomain.com npm run db:clean');
    await client.end();
    return;
  }

  // 保证目标域名以规范的协议开头且末尾不带斜杠
  const cleanNewDomain = newDomain.trim().replace(/\/+$/, '');
  console.log(`🎯 目标公网清洗域名: ${cleanNewDomain}`);

  try {
    // 2. 查询出数据库内所有已注册的 SSO 客户端
    const allClients = await db.select().from(schema.clients);
    let totalUpdated = 0;

    for (const c of allClients) {
      let isUpdated = false;
      let redirectUrls = c.redirectUrls;
      let homepageUrl = c.homepageUrl || '';

      // 正则匹配 http://localhost:<端口> 或者 http://127.0.0.1:<端口>
      const localhostRegex = /http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g;

      // a. 洗涤重定向回调回调 URL 组 (以逗号分隔的列表)
      if (localhostRegex.test(redirectUrls)) {
        redirectUrls = redirectUrls.replace(localhostRegex, cleanNewDomain);
        isUpdated = true;
      }

      // b. 洗涤客户端主页 URL
      if (homepageUrl && localhostRegex.test(homepageUrl)) {
        homepageUrl = homepageUrl.replace(localhostRegex, cleanNewDomain);
        isUpdated = true;
      }

      // c. 如果指定了特定的老域名 OLD_DOMAIN，也做一次全局强力清洗
      if (process.env.OLD_DOMAIN) {
        const oldDomain = process.env.OLD_DOMAIN.trim().replace(/\/+$/, '');
        if (redirectUrls.includes(oldDomain)) {
          redirectUrls = redirectUrls.split(',').map(url => url.replace(oldDomain, cleanNewDomain)).join(',');
          isUpdated = true;
        }
        if (homepageUrl && homepageUrl.includes(oldDomain)) {
          homepageUrl = homepageUrl.replace(oldDomain, cleanNewDomain);
          isUpdated = true;
        }
      }

      // 3. 执行外科手术式更新
      if (isUpdated) {
        await db.update(schema.clients)
          .set({
            redirectUrls,
            homepageUrl: homepageUrl || null,
            updatedAt: new Date()
          })
          .where(eq(schema.clients.id, c.id));
        
        console.log(`✅ 成功洗涤客户端: [${c.name}] (${c.clientId})`);
        console.log(`   - 洗涤后 Redirect URIs: ${redirectUrls}`);
        if (homepageUrl) {
          console.log(`   - 洗涤后 Homepage URL: ${homepageUrl}`);
        }
        totalUpdated++;
      }
    }

    console.log(`✨ 洗涤完成！共计清洗并加固了 ${totalUpdated} 个客户端的本地配置。`);
  } catch (error) {
    console.error('❌ 执行域名洗涤时发生未知异常：', error);
  } finally {
    // 优雅释放数据库连接池
    await client.end();
  }
}

cleanClients().catch(console.error);

# Auth-SSO 生产环境 Docker 部署方案

## 1. 架构说明
本方案采用 Docker Compose 进行手动部署。包含以下组件：
- **Portal (含 OIDC Provider)**: 管理后台 + 统一身份认证中心，运行在 4000 端口。
- **Gateway (Pingora)**: Rust 自研网关，HTTPS 终结 + JWT 验签。
- **PostgreSQL**: 核心数据库，不对公网暴露 5432 端口。
- **Redis**: 缓存与 Session 存储，不对公网暴露 6379 端口。

## 2. 目录结构
```text
/opt/auth-sso/
├── docker-compose.yml
├── .env.prod
└── data/
    ├── postgres/
    └── redis/
```

## 3. 安全加固特性
- **信创合规**: 使用 Rust (Pingora) 自研网关替代 Nginx，消除闭源/厂商依赖风险。
- **HTTPS 强制**: 网关已配置 80 -> 443 自动跳转。
- **IP 记录**: 已在代码层面实现 `x-forwarded-for` 解析，网关已配置协议转发。

## 4. 部署步骤
1. 安装 Docker & Docker Compose。
2. 配置域名解析：将 `portal.yourdomain.com` 指向服务器 IP（IDP 已合并进 Portal）。
3. 获取 SSL 证书（推荐使用 Certbot）：
   ```bash
   docker run -it --rm --name certbot \
     -v "$(pwd)/data/certbot/conf:/etc/letsencrypt" \
     -v "$(pwd)/data/certbot/www:/var/www/certbot" \
     certbot/certbot certonly --webroot -w /var/www/certbot \
     -d portal.yourdomain.com
   ```
4. 证书目录映射：确保证书文件位于 `data/certbot/conf/live/yourdomain.com/` 下。
5. 启动服务：`docker-compose -f docker-compose.prod.yml up -d --build`。
6. 数据库初始化：`docker exec -i auth-sso-postgres psql -U postgres < init-db.sql`。

## 5. 注意事项 (IMPORTANT)
- **HTTPS 协议**: 在 `.env.prod` 中，`BETTER_AUTH_URL` 和 `NEXT_PUBLIC_APP_URL` 必须以 `https://` 开头。
- **代理透传**: Nginx 必须转发 `X-Forwarded-Proto: https`，否则 Better Auth 会因协议不匹配拒绝签发 Cookie。


# 补全 HTTPS 安全部署环结 - 采用 Pingora 自研信创网关

## 1. 背景与动机 (Background & Motivation)
根据用户反馈，传统的 Nginx 不在信创（信息技术应用创新）推荐目录中。为了满足合规性要求并追求更高的安全与性能，本项目将弃用 Nginx，转而采用基于 Rust 语言编写的 **Pingora** 框架自研轻量级网关。Rust 的内存安全性天然符合高安全等级部署的要求。

## 2. 方案目标 (Objective)
- **HTTPS 终止**：在网关层处理 TLS 握手。
- **SNI 动态路由**：
    - `idp.yourdomain.com` -> `http://idp:4001`
    - `portal.yourdomain.com` -> `http://portal:4000`
- **安全加固**：强制 HTTP 到 HTTPS 的跳转，转发真实客户端 IP (`X-Real-IP`) 和协议 (`X-Forwarded-Proto`)。
- **信创适配**：全 Rust 实现，避开 Nginx 及其衍生版的合规限制。

## 3. 核心变动 (Changes)

### 3.1 模块实现 (`apps/gateway`)
- **Cargo 配置**：引入 `pingora`, `async-trait`, `http`, `log`, `env_logger` 等。
- **代码实现**：
    - 使用 `pingora::proxy::ProxyHttp` Trait 实现代理服务。
    - **域名路由规则**：
        - `idp.*` -> `idp:4001`
        - `portal.*` -> `portal:4000`
    - **HTTPS 加固**：
        - 在 `pre_proxy` 阶段注入 `X-Forwarded-Proto: https`。
        - 处理 TLS 证书路径（默认从 `/etc/gateway/ssl/` 读取）。
    - **强制跳转**：监听 80 端口的服务执行 301 重定向。

### 3.2 部署加固
- **Dockerfile**：采用多阶段构建，静态链接 `musl` 以消除 glibc 依赖。
- **docker-compose.prod.yml**：
    ```yaml
    gateway:
      build:
        context: .
        dockerfile: apps/gateway/Dockerfile
      container_name: auth-sso-gateway
      ports:
        - "80:80"
        - "443:443"
      volumes:
        - ./data/certbot/conf:/etc/gateway/ssl:ro
      depends_on:
        - idp
        - portal
      networks:
        - auth-sso-net
    ```

## 4. 实施计划 (Phased Implementation Plan)

### 第一阶段：Rust 网关开发 (Targeting M6)
- 初始化 `apps/gateway` 目录。
- 编写 `Cargo.toml` 依赖。
- 编写 `src/main.rs`：实现域名嗅探与 upstream 转发。
- 编写 `apps/gateway/Dockerfile`。

### 第二阶段：环境适配与集成
- 修改 `docker-compose.prod.yml` 彻底移除 `nginx`。
- 将 `gateway` 服务加入网络。
- 确保证书挂载路径与 Certbot 输出路径一致（`/etc/letsencrypt/live/xxx` -> `/etc/gateway/ssl/live/xxx`）。


### 第三阶段：验证
- 本地构建镜像并启动。
- 使用 `curl` 验证域名分发、HTTPS 跳转以及 `X-Forwarded-Proto` 头部透传。

## 5. 验证与测试 (Verification)
- **连通性测试**：确保 `curl -k` 访问网关能正确触达后端子应用。
- **协议测试**：验证 `Better Auth` 的 Secure Cookie 在 Pingora 代理后能正常工作。
- **性能评估**：Pingora 相比 Nginx 在高并发场景下的稳定性。

## 6. 待确认项
- 证书管理：是否仍采用 Certbot 容器产生 PEM 文件供 Pingora 读取？（推荐维持现状）。
- 域名绑定：是否需要支持通配符或多个子域名？

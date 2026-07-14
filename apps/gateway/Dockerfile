# Build stage
FROM rust:1.88-alpine AS builder

# 安装构建依赖（添加 alpine-sdk 以及构建 vendored openssl 所需的基础工具）
RUN apk add --no-cache musl-dev pkgconfig perl make cmake clang-dev clang alpine-sdk

WORKDIR /app

# 复制 gateway 子项目的 Cargo 配置
COPY apps/gateway/Cargo.toml apps/gateway/Cargo.lock ./apps/gateway/

# 复制整个项目根目录的 Cargo.lock，如果存在（这里我们是 monorepo，有 apps/gateway/Cargo.lock）
# 将工作目录切换到网关
WORKDIR /app/apps/gateway

# 创建一个假的 main.rs 以构建和缓存依赖项
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release --bin gateway
RUN rm -rf src

# 复制真正的源码并重新编译
COPY apps/gateway/src ./src
# 更新文件修改时间，以防 cargo 认为 src 没有变化而不进行编译
RUN touch src/main.rs && cargo build --release

# Runner stage
FROM alpine:latest

# 创建非 root 用户（安全加固：禁止容器以 root 运行）
RUN addgroup -S gateway && adduser -S gateway -G gateway

WORKDIR /app

# 安装 ca-certificates 运行时证书支持
RUN apk add --no-cache ca-certificates

# 从构建阶段复制二进制文件
COPY --from=builder /app/apps/gateway/target/release/gateway /usr/local/bin/gateway

# 复制 Docker 环境专用配置文件（upstream/issuer/redis 使用 Docker 内部地址）
COPY apps/gateway/gateway.docker.toml ./gateway.toml

# 创建 SSL 目录挂载点并授予 gateway 用户权限
RUN mkdir -p /etc/gateway/ssl && chown -R gateway:gateway /etc/gateway/ssl

EXPOSE 80 443

# 设置日志级别
ENV RUST_LOG=info

# 切换到非 root 用户运行
USER gateway

CMD ["gateway"]

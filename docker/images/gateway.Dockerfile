FROM alpine:3.24 AS cert-init

RUN apk add --no-cache openssl

# Build stage
FROM rust:1.99-alpine AS builder

# 构建 vendored OpenSSL 所需的最小工具集
RUN apk add --no-cache build-base pkgconfig perl cmake clang-dev clang

WORKDIR /app

# 复制 gateway 子项目的 Cargo 配置
COPY apps/gateway/Cargo.toml apps/gateway/Cargo.lock ./apps/gateway/
COPY apps/gateway/benches ./apps/gateway/benches

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

# Runtime stage
FROM alpine:3.24

WORKDIR /app

# 运行时依赖 + 非 root 用户 + 可写目录，合并为一层
RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 gateway \
    && adduser -S -u 10001 gateway -G gateway \
    && mkdir -p /etc/gateway/ssl /var/lib/gateway/acme /app/logs \
    && chown -R gateway:gateway /etc/gateway/ssl /var/lib/gateway/acme /app/logs

# 从构建阶段复制二进制文件
COPY --from=builder /app/apps/gateway/target/release/gateway /usr/local/bin/gateway

# 复制 Docker 环境专用配置文件（upstream/issuer/redis 使用 Docker 内部地址）
COPY apps/gateway/gateway.docker.toml ./gateway.toml

EXPOSE 80 443

# 设置日志级别
# 不设 RUST_LOG：日志级别由配置的 log_level 决定（配置为单一真相源）。
# RUST_LOG 仍可作运维应急覆盖（tracing 的 EnvFilter 优先级高于配置）。

# 切换到非 root 用户运行
USER gateway

CMD ["gateway"]

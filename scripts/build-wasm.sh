#!/bin/bash
# WASM 构建脚本
# 用于在 CI/CD 中预构建 WASM 模块

set -e

echo "Building WASM module..."

# 检查 wasm-pack 是否安装
if ! command -v wasm-pack &> /dev/null; then
    echo "Installing wasm-pack..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# 构建 WASM 模块
cd "$(dirname "$0")/../wasm-engine"
wasm-pack build --target web --out-dir ../apps/customer-graph/public/wasm

echo "WASM build complete!"
ls -la ../apps/customer-graph/public/wasm/
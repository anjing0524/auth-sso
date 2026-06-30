<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

use architecting-portal skill

use spec-docs skill

`@docs/spec/*` 文档提供理论支持

修改文档前务必重新阅读，文档可能被多人更新

rust 代码修改后必须修复cargo clippy的所有错误并执行 cargo fmt 格式化

rust 代码遵循 https://rust-lang.github.io/api-guidelines/checklist.html

当前 Rust 版本环境约定（Rust 1.93.0+）：对于需要多线程并发调度（Send 约束）的 Trait 异步方法，必须采用“零开销异步 Trait”最佳实践：在 Trait 定义中使用 `-> impl std::future::Future<Output = T> + Send` 进行严格的线程安全约束，并在 `impl` 实现块中直接使用 `async fn` 语法以保持代码简洁。坚决避免引入 `#[async_trait]` 带来的 Box 堆分配开销。

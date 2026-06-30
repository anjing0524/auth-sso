use tracing_subscriber::{EnvFilter, fmt, prelude::*};

/// 初始化 Tracing 日志系统
/// 建立 Stdout 与每日滚动文件的双 Layer 订阅机制，并返回非阻塞缓冲写入 Guard
///
/// # Examples
///
/// ```ignore
/// // 在 main 中调用，返回的 guard 需 held 到进程退出
/// let _guard = init_tracing("logs", "info");
/// ```
///
/// # 参数
/// * `log_dir` - 日志存储目录
/// * `log_level` - 日志输出级别（如 "info", "debug"）
pub fn init_tracing(log_dir: &str, log_level: &str) -> tracing_appender::non_blocking::WorkerGuard {
    // 1. 创建每日切分的日志 Appender，名字格式为 gateway.log.YYYY-MM-DD
    let file_appender = tracing_appender::rolling::daily(log_dir, "gateway.log");
    // 2. 利用非阻塞缓冲区异步落地，防止高并发 I/O 阻塞主服务工作线程
    let (non_blocking_file, guard) = tracing_appender::non_blocking(file_appender);

    // 3. 构建控制台输出 Layer (带 ANSI 颜色渲染)
    let stdout_layer = fmt::layer().with_ansi(true).with_target(true);

    // 4. 构建文件落地 Layer (去除颜色)
    let file_layer = fmt::layer().with_ansi(false).with_writer(non_blocking_file);

    // 5. 设置日志过滤级
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(log_level));

    // 6. 组合多重 Layer 并注册为系统全局的 Default Dispatcher
    tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();

    guard
}

# 2026-06-16 SSO 网关配置系统极简化设计说明书 (Config Simplification Spec)

本设计文档旨在遵循 **YAGNI（极简主义）** 哲学对 `apps/gateway` 的配置系统进行重构。我们将删除所有系统环境变量覆盖及配套解析映射代码，使网关的配置加载流程转为纯粹的“配置文件单一输入源”驱动，以最大程度地精简代码、降低配置歧义并提升系统的长期稳定性。

## 1. 重构方案设计

### 1.1 移除环境变量源 (`src/config.rs`)
* 彻底删除 `GatewayEnvSource` 结构体及其对 `config::Source` 的 trait 实现。
* 彻底删除 `Config::load` 尾部针对列表型环境变量 `PORTAL_PUBLIC_PATHS` 的后处理解析代码。

### 1.2 简化配置加载流 (`Config::load`)
`Config::load` 的构建过程将被简化为仅包含本地 TOML 配置文件源的单源加载：
```rust
pub fn load(path: &str) -> Self {
    let builder = config::Config::builder()
        .add_source(config::File::with_name(path).required(false));

    match builder.build() {
        Ok(config_build) => match config_build.try_deserialize::<Config>() {
            Ok(cfg) => {
                if std::path::Path::new(path).exists() {
                    info!("✅ 成功从配置文件 {} 加载网关配置", path);
                } else {
                    info!("ℹ️ 配置文件 {} 未找到，将使用默认基础配置", path);
                }
                cfg
            }
            Err(e) => {
                error!("❌ 配置文件 {} 反序列化失败: {:?}", path, e);
                panic!("网关配置文件解析失败: {:?}", e);
            }
        },
        Err(e) => {
            error!("❌ 配置文件 {} 加载失败: {:?}", path, e);
            panic!("网关配置文件解析失败: {:?}", e);
        }
    }
}
```

### 1.3 净化单元测试 (`src/config.rs`)
* 在单元测试 `test_config_all` 中，彻底移除第 2 部分（设置环境变量、验证环境变量覆盖、清理环境变量）的所有 `set_var` / `remove_var` 等安全隐患与冗余逻辑代码。
* 仅保留第 1 部分（TOML 整体加载验证）与第 3 部分（TOML 局部缺失时与 `Default` 字段合并填充验证）。

---

## 2. 部署影响与指导
由于环境变量覆盖被废除，K8s 或 Docker-compose 部署网关如果需要改变参数（如 upstream 或端口），直接通过容器挂载映射修改好的 `gateway.toml` 文件到容器对应路径即可。这更利于将“配置”作为版本受控的文件物料进行规范化运维。

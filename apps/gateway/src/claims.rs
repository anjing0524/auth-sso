use serde::{Deserialize, Serialize};

/// JWT 载荷核心声明（验签时只需这几个字段，权限细节由微服务自行解析）
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub iss: String,
    pub exp: usize,
    pub jti: String,
}

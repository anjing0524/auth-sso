use serde::{Deserialize, Serialize};

/// JWT 载荷完整声明（Portal signAccessToken 签发时总是包含全部字段）
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claims {
    pub sub: String,
    pub iss: String,
    pub aud: String,
    pub exp: usize,
    pub jti: String,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    pub dept_id: String,
    pub data_scope_type: String,
}

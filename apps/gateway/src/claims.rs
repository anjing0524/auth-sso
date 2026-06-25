use serde::{Deserialize, Serialize};

/// JWT 载荷完整声明（Portal signAccessToken 签发时总是包含全部字段）
/// v3.2: dept_id + data_scope_type 替换为 dept_ids (string[])
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
    /// 用户所有角色所属部门（含子树展开）的 ID 列表
    pub dept_ids: Vec<String>,
}

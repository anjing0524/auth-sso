/**
 * 密码哈希工具 — 重新导出 domain/auth/password 的纯函数实现
 * （保留此文件以兼容现有导入路径，避免修改所有 Controller）
 */
export { hashPassword, verifyPassword } from '@/domain/auth/password';

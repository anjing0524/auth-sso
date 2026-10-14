//! 仓库卫生守卫 —— 生产代码里的**测试缝**必须当场登记
//!
//! ## 为什么需要（#88 / ADR-022 的 Rust 侧）
//!
//! ADR-022 为 TS 侧建立了 `@allow-module-mock` 纪律：**任何生产模块的替身都必须带理由注解**，
//! 由 `module-mock-guard.test.ts` 机械校验。Rust 侧原本挂着"另立 effort"。
//!
//! 2026-10-14 的**普查**（见下）结论：Rust **没有**"整体替换式 test double"——
//! 没有模块级 mock、没有 DI 容器、依赖经 `Arc`/显式参数注入、测试直接构造真实值。
//! 因此那条"effort"没有主体。
//!
//! **但普查同时发现真正需要看管的东西**：`#[cfg(test)]` 出现在**生产模块内**的
//! "测试缝"（例如 `JwtVerifier::new_without_revocation_for_test` —— 它关掉 Redis 撤销检查）。
//! 这类缝能悄悄削弱测试（"被测语义被替身删掉"正是 ADR-022 要防的），
//! 所以本守卫要求：**新增测试缝必须在下面登记，并写明理由**。
//!
//! ## 普查方法（可复跑）
//!
//! ```text
//! grep -rniE "struct (Fake|Mock|Stub|Dummy|Test)[A-Za-z]*|enum (Fake|Mock|Stub)" src/
//! grep -rn  "impl .* for .*" src/*/tests.rs
//! grep -rniE "call_count|times_called|assert.*called" src/
//! grep -rn  "cfg(test)\|cfg!(test)" src/ | grep -v "mod tests"
//! ```

use std::fs;
use std::path::{Path, PathBuf};

/// 生产模块内的测试缝登记表：`(文件相对路径, 条目名, 理由)`
///
/// **新增条目必须写明理由**——这正是 ADR-022 对 TS 侧 mock 的要求。
const DECLARED_SEAMS: &[(&str, &str, &str)] = &[(
    "src/auth/verify.rs",
    "new_without_revocation_for_test",
    "仅供密码学单测：隔离 Redis 撤销检查，验证签名/issuer/过期判定（撤销行为另有专测）",
)];

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// 找出"生产模块内的测试缝"：`#[cfg(test)]` 后面**不是** `mod tests` 的位置。
///
/// 返回 `(文件相对路径, 紧随其后的条目名)`。
fn find_test_seams() -> Vec<(String, String)> {
    let mut files = Vec::new();
    collect_rs_files(&src_dir(), &mut files);

    let mut seams = Vec::new();
    for file in files {
        let Ok(source) = fs::read_to_string(&file) else {
            continue;
        };
        let lines: Vec<&str> = source.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if !line.trim_start().starts_with("#[cfg(test)]") {
                continue;
            }
            // 紧随其后的非空行：`mod tests` / `mod tests;` 属测试模块声明，不算缝
            let next = lines[i + 1..]
                .iter()
                .map(|l| l.trim())
                .find(|l| !l.is_empty());
            // `mod <任意名>;` / `mod <任意名> {` 都是**测试模块声明**（不是缝）：
            // 例如 `mod tests;`、`mod contract_tests;`、`mod test_hygiene_tests;`
            let is_test_module_decl =
                next.is_some_and(|n| n.starts_with("mod ") || n.starts_with("pub mod "));
            if is_test_module_decl {
                continue;
            }

            // 条目名取"下一个非空、非属性行的首个标识符片段"
            let item = lines[i + 1..]
                .iter()
                .map(|l| l.trim())
                .find(|l| !l.is_empty() && !l.starts_with("#["))
                .map_or_else(
                    || "<unknown>".to_string(),
                    |l| {
                        let l = l
                            .trim_start_matches("pub(crate) ")
                            .trim_start_matches("pub ");
                        let mut tokens = l.split_whitespace();
                        let first = tokens.next().unwrap_or("<unknown>");
                        // `fn foo(...)` / `struct Foo {` / `const X: T` ⇒ 取名字（第二个词）
                        let named = if matches!(
                            first,
                            "fn" | "struct" | "enum" | "const" | "static" | "trait" | "type"
                        ) {
                            tokens.next().unwrap_or("<unknown>")
                        } else {
                            first
                        };
                        named
                            .split(['(', ' ', '<', ':', '=', ';'])
                            .next()
                            .unwrap_or("<unknown>")
                            .to_string()
                    },
                );

            let rel = file
                .strip_prefix(Path::new(env!("CARGO_MANIFEST_DIR")))
                .unwrap_or(&file)
                .to_string_lossy()
                .replace('\\', "/");
            seams.push((rel, item));
        }
    }

    seams.sort();
    seams
}

#[test]
fn test_every_production_test_seam_is_declared_with_a_reason() {
    let seams = find_test_seams();

    let undeclared: Vec<String> = seams
        .iter()
        .filter(|(file, item)| {
            !DECLARED_SEAMS
                .iter()
                .any(|(f, i, _)| f == file && i == item)
        })
        .map(|(file, item)| format!("{file} :: {item}"))
        .collect();

    assert!(
        undeclared.is_empty(),
        "生产模块内出现未登记的测试缝（#88 / ADR-022 的 Rust 侧纪律）：\n  {}\n\
         ⇒ 在 src/test_hygiene_tests.rs 的 DECLARED_SEAMS 里登记并写明理由，\
         或改为生产可达的注入点（参数化依赖）。",
        undeclared.join("\n  ")
    );

    // 反向：登记表里的条目必须仍然存在（防止"缝已删除、登记还留着"）
    let stale: Vec<String> = DECLARED_SEAMS
        .iter()
        .filter(|(f, i, _)| !seams.iter().any(|(sf, si)| sf == f && si == i))
        .map(|(f, i, _)| format!("{f} :: {i}"))
        .collect();

    assert!(
        stale.is_empty(),
        "DECLARED_SEAMS 里的条目已不存在（请同步删除）：\n  {}",
        stale.join("\n  ")
    );
}

#[test]
fn test_seam_scanner_finds_the_known_seam() {
    // 解析器自测：扫描器失灵会让上面的守卫"永远通过"
    let seams = find_test_seams();
    assert!(
        seams
            .iter()
            .any(|(f, i)| f == "src/auth/verify.rs" && i == "new_without_revocation_for_test"),
        "扫描器未能识别已知测试缝，实际扫描结果：{seams:?}"
    );
}

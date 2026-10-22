use arc_swap::ArcSwapOption;
use pingora_core::listeners::TlsAccept;
use pingora_core::protocols::tls::TlsRef;
use pingora_core::tls::ext;
use pingora_core::tls::pkey::{PKey, Private};
use pingora_core::tls::x509::X509;
use sha2::{Digest, Sha256};
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::error;

/// TLS 证书解析、校验或文件读取错误。
#[derive(thiserror::Error, Debug)]
pub enum TlsCertificateError {
    #[error("读取 TLS 文件 {path} 失败: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("TLS fullchain 未包含证书")]
    EmptyCertificateChain,
    #[error("解析 TLS fullchain 失败: {0}")]
    CertificateParse(#[source] openssl::error::ErrorStack),
    #[error("解析 TLS 私钥失败: {0}")]
    PrivateKeyParse(#[source] openssl::error::ErrorStack),
    #[error("读取 TLS 叶证书公钥失败: {0}")]
    PublicKeyRead(#[source] openssl::error::ErrorStack),
    #[error("TLS 叶证书与私钥不匹配")]
    KeyMismatch,
}

/// 一次 TLS 快照安装或重载的结果。
#[derive(Debug, Eq, PartialEq)]
pub enum TlsReloadOutcome {
    /// 已安装新的有效快照。
    Loaded,
    /// 输入与当前快照完全一致。
    Unchanged,
}

struct TlsCertificateSnapshot {
    certificates: Vec<X509>,
    private_key: PKey<Private>,
    digest: [u8; 32],
}

impl TlsCertificateSnapshot {
    fn from_pem(
        certificate_pem: &[u8],
        private_key_pem: &[u8],
    ) -> Result<Self, TlsCertificateError> {
        let certificates =
            X509::stack_from_pem(certificate_pem).map_err(TlsCertificateError::CertificateParse)?;
        let leaf = certificates
            .first()
            .ok_or(TlsCertificateError::EmptyCertificateChain)?;
        let private_key = PKey::private_key_from_pem(private_key_pem)
            .map_err(TlsCertificateError::PrivateKeyParse)?;
        let public_key = leaf
            .public_key()
            .map_err(TlsCertificateError::PublicKeyRead)?;
        if !public_key.public_eq(&private_key) {
            return Err(TlsCertificateError::KeyMismatch);
        }

        let mut hasher = Sha256::new();
        hasher.update(certificate_pem);
        hasher.update([0]);
        hasher.update(private_key_pem);

        Ok(Self {
            certificates,
            private_key,
            digest: hasher.finalize().into(),
        })
    }

    fn apply(&self, ssl: &mut TlsRef) -> Result<(), openssl::error::ErrorStack> {
        let (leaf, chain) = self
            .certificates
            .split_first()
            .expect("TLS 快照构造时已保证证书链非空");
        ext::ssl_use_certificate(ssl, leaf)?;
        ext::ssl_use_private_key(ssl, &self.private_key)?;
        for certificate in chain {
            ext::ssl_add_chain_cert(ssl, certificate)?;
        }
        Ok(())
    }
}

/// TLS 证书快照存储。
///
/// Gateway 在证书来源更新后先完整解析证书链并校验证书/私钥匹配，再通过
/// [`ArcSwapOption`] 原子替换快照。握手热路径只执行一次 wait-free 原子读取，
/// 不访问磁盘，也不会观察到半更新的证书对。
pub struct TlsCertificateStore {
    inner: ArcSwapOption<TlsCertificateSnapshot>,
}

impl std::fmt::Debug for TlsCertificateStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TlsCertificateStore")
            .field("has_certificate", &self.has_certificate())
            .finish()
    }
}

impl TlsCertificateStore {
    /// 创建没有初始证书的内存存储，供 Gateway 内建 ACME 客户端引导使用。
    pub fn empty() -> Self {
        Self {
            inner: ArcSwapOption::empty(),
        }
    }

    /// 从已经配对校验的 PEM 内容创建内存存储。
    pub fn from_pem(
        certificate_pem: &[u8],
        private_key_pem: &[u8],
    ) -> Result<Self, TlsCertificateError> {
        Ok(Self {
            inner: ArcSwapOption::from_pointee(TlsCertificateSnapshot::from_pem(
                certificate_pem,
                private_key_pem,
            )?),
        })
    }

    /// 从文件加载初始证书。
    pub fn load(
        certificate_path: impl Into<PathBuf>,
        private_key_path: impl Into<PathBuf>,
    ) -> Result<Self, TlsCertificateError> {
        let certificate_path = certificate_path.into();
        let private_key_path = private_key_path.into();
        let certificate_pem =
            std::fs::read(&certificate_path).map_err(|source| TlsCertificateError::Read {
                path: certificate_path,
                source,
            })?;
        let private_key_pem =
            std::fs::read(&private_key_path).map_err(|source| TlsCertificateError::Read {
                path: private_key_path,
                source,
            })?;
        Self::from_pem(&certificate_pem, &private_key_pem)
    }

    /// 判断当前是否存在可用于握手的证书快照。
    pub fn has_certificate(&self) -> bool {
        self.inner.load().is_some()
    }

    /// 返回当前叶证书 DER，用于 ACME ARI 续期判断。
    pub fn leaf_certificate_der(&self) -> Result<Option<Vec<u8>>, TlsCertificateError> {
        self.inner
            .load()
            .as_ref()
            .map(|snapshot| {
                snapshot.certificates[0]
                    .to_der()
                    .map_err(TlsCertificateError::CertificateParse)
            })
            .transpose()
    }

    /// 校验并原子安装一对 PEM 证书链和私钥。
    pub fn install_pem(
        &self,
        certificate_pem: &[u8],
        private_key_pem: &[u8],
    ) -> Result<TlsReloadOutcome, TlsCertificateError> {
        let snapshot = TlsCertificateSnapshot::from_pem(certificate_pem, private_key_pem)?;
        if self
            .inner
            .load()
            .as_ref()
            .is_some_and(|current| current.digest == snapshot.digest)
        {
            return Ok(TlsReloadOutcome::Unchanged);
        }

        self.inner.store(Some(Arc::new(snapshot)));
        Ok(TlsReloadOutcome::Loaded)
    }
}

/// 在每次 TLS 握手时应用当前不可变证书快照。
#[derive(Debug)]
pub struct TlsCertificateCallback {
    store: Arc<TlsCertificateStore>,
}

impl TlsCertificateCallback {
    /// 创建读取指定证书存储的 TLS 回调。
    pub fn new(store: Arc<TlsCertificateStore>) -> Self {
        Self { store }
    }
}

#[async_trait::async_trait]
impl TlsAccept for TlsCertificateCallback {
    async fn certificate_callback(&self, ssl: &mut TlsRef) {
        let snapshot = self.store.inner.load();
        let Some(snapshot) = snapshot.as_ref() else {
            return;
        };
        if let Err(error) = snapshot.apply(ssl) {
            error!("TLS 握手应用证书快照失败: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openssl::asn1::Asn1Time;
    use openssl::bn::{BigNum, MsbOption};
    use openssl::hash::MessageDigest;
    use openssl::nid::Nid;
    use openssl::rsa::Rsa;
    use openssl::x509::{X509Builder, X509NameBuilder};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let id = TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "auth-sso-gateway-tls-test-{}-{id}",
                std::process::id()
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn certificate_pair(common_name: &str) -> (Vec<u8>, Vec<u8>) {
        let rsa = Rsa::generate(2048).unwrap();
        let private_key = PKey::from_rsa(rsa).unwrap();

        let mut name = X509NameBuilder::new().unwrap();
        name.append_entry_by_nid(Nid::COMMONNAME, common_name)
            .unwrap();
        let name = name.build();

        let mut serial = BigNum::new().unwrap();
        serial.rand(128, MsbOption::MAYBE_ZERO, false).unwrap();
        let serial = serial.to_asn1_integer().unwrap();

        let mut certificate = X509Builder::new().unwrap();
        certificate.set_version(2).unwrap();
        certificate.set_serial_number(&serial).unwrap();
        certificate.set_subject_name(&name).unwrap();
        certificate.set_issuer_name(&name).unwrap();
        certificate.set_pubkey(&private_key).unwrap();
        certificate
            .set_not_before(&Asn1Time::days_from_now(0).unwrap())
            .unwrap();
        certificate
            .set_not_after(&Asn1Time::days_from_now(30).unwrap())
            .unwrap();
        certificate
            .sign(&private_key, MessageDigest::sha256())
            .unwrap();

        (
            certificate.build().to_pem().unwrap(),
            private_key.private_key_to_pem_pkcs8().unwrap(),
        )
    }

    #[test]
    fn snapshot_rejects_mismatched_private_key() {
        let (certificate, _) = certificate_pair("one.example.com");
        let (_, other_private_key) = certificate_pair("two.example.com");

        let result = TlsCertificateSnapshot::from_pem(&certificate, &other_private_key);
        assert!(matches!(result, Err(TlsCertificateError::KeyMismatch)));
    }

    #[test]
    fn empty_store_allows_acme_bootstrap_then_installs_certificate() {
        let store = TlsCertificateStore::empty();
        assert!(!store.has_certificate());

        let (certificate, private_key) = certificate_pair("sso.example.com");
        assert_eq!(
            store.install_pem(&certificate, &private_key).unwrap(),
            TlsReloadOutcome::Loaded
        );
        assert!(store.has_certificate());
        assert!(store.leaf_certificate_der().unwrap().is_some());
        assert_eq!(
            store.install_pem(&certificate, &private_key).unwrap(),
            TlsReloadOutcome::Unchanged
        );
    }

    #[test]
    fn file_store_requires_initial_certificate() {
        let directory = TestDir::new();
        let result = TlsCertificateStore::load(
            directory.0.join("fullchain.pem"),
            directory.0.join("privkey.pem"),
        );
        assert!(matches!(result, Err(TlsCertificateError::Read { .. })));
    }

    #[test]
    fn store_retains_last_snapshot_when_new_pair_is_invalid() {
        let (certificate, private_key) = certificate_pair("current.example.com");
        let store = TlsCertificateStore::from_pem(&certificate, &private_key).unwrap();
        let current_digest = store.inner.load_full().unwrap().digest;

        let (replacement_certificate, _) = certificate_pair("next.example.com");

        assert!(matches!(
            store.install_pem(&replacement_certificate, &private_key),
            Err(TlsCertificateError::KeyMismatch)
        ));
        assert_eq!(store.inner.load_full().unwrap().digest, current_digest);
    }
}

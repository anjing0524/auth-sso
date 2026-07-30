use anyhow::{Context as _, bail};
use arc_swap::ArcSwapOption;
use bytes::Bytes;
use instant_acme::{
    Account, AccountBuilder, AccountCredentials, AuthorizationStatus, CertificateIdentifier,
    ChallengeType, Identifier, NewAccount, NewOrder, OrderStatus, RetryPolicy, SuggestedWindow,
};
use pingora_core::server::ShutdownWatch;
use pingora_core::services::background::BackgroundService;
use rustls_pki_types::CertificateDer;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use time::OffsetDateTime;
use tokio::net::TcpStream;
use tracing::{debug, info, warn};
use x509_parser::prelude::{FromDer, X509Certificate};

use crate::config::AcmeConfig;
use crate::tls::{TlsCertificateStore, TlsReloadOutcome};

/// HTTP-01 challenge 的标准路径前缀。
pub const ACME_CHALLENGE_PREFIX: &str = "/.well-known/acme-challenge/";

const LISTENER_READINESS_RETRY_DELAY: Duration = Duration::from_millis(250);
const ACME_MIN_RETRY_DELAY: Duration = Duration::from_secs(60);
const ACME_MAX_RETRY_DELAY: Duration = Duration::from_secs(3_600);
const MIN_SCHEDULE_DELAY: Duration = Duration::from_secs(60);

#[derive(Debug)]
struct AcmeChallengeResponse {
    token: String,
    body: Bytes,
}

/// HTTP-01 challenge 的单值无锁快照。
///
/// 当前 Gateway 仅为一个域名创建一个 ACME order，因此同时最多存在一个有效
/// challenge。请求热路径只执行原子读取和 token 比较。
#[derive(Debug)]
pub struct AcmeChallengeStore {
    inner: ArcSwapOption<AcmeChallengeResponse>,
}

impl AcmeChallengeStore {
    /// 创建没有有效 challenge 的内存快照。
    pub fn new() -> Self {
        Self {
            inner: ArcSwapOption::empty(),
        }
    }

    /// 判断请求路径是否属于 HTTP-01 challenge 命名空间。
    pub fn is_challenge_path(path: &str) -> bool {
        path.starts_with(ACME_CHALLENGE_PREFIX)
    }

    /// 对当前 order 的精确 challenge 路径返回 key-authorization。
    pub fn response_for_path(&self, path: &str) -> Option<Bytes> {
        let token = challenge_token(path)?;
        self.inner
            .load()
            .as_ref()
            .filter(|response| response.token == token)
            .map(|response| response.body.clone())
    }

    fn install(
        self: &Arc<Self>,
        token: String,
        key_authorization: String,
    ) -> anyhow::Result<AcmeChallengeLease> {
        if !is_valid_challenge_token(&token) {
            bail!("ACME 服务端返回了不安全的 HTTP-01 token");
        }
        self.inner.store(Some(Arc::new(AcmeChallengeResponse {
            token: token.clone(),
            body: Bytes::from(key_authorization),
        })));
        Ok(AcmeChallengeLease {
            store: Arc::clone(self),
            token,
        })
    }

    fn clear(&self, token: &str) {
        if self
            .inner
            .load()
            .as_ref()
            .is_some_and(|response| response.token == token)
        {
            self.inner.store(None);
        }
    }
}

impl Default for AcmeChallengeStore {
    fn default() -> Self {
        Self::new()
    }
}

fn challenge_token(path: &str) -> Option<&str> {
    let token = path.strip_prefix(ACME_CHALLENGE_PREFIX)?;
    is_valid_challenge_token(token).then_some(token)
}

fn is_valid_challenge_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 256
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

struct AcmeChallengeLease {
    store: Arc<AcmeChallengeStore>,
    token: String,
}

impl Drop for AcmeChallengeLease {
    fn drop(&mut self) {
        self.store.clear(&self.token);
    }
}

#[derive(Serialize, Deserialize)]
struct PersistedAccount {
    directory_url: String,
    credentials: AccountCredentials,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedCertificate {
    domain: String,
    directory_url: String,
    fullchain_pem: String,
    private_key_pem: String,
}

/// Gateway ACME 状态目录。
///
/// 账户密钥与证书私钥均以 `0600` 单文件原子持久化。证书链和私钥放在同一个
/// JSON bundle 中，使进程崩溃或主机掉电后不会留下跨文件的半更新证书对。
#[derive(Clone, Debug)]
pub struct AcmeState {
    domain: String,
    directory_url: String,
    account_path: PathBuf,
    certificate_path: PathBuf,
}

impl AcmeState {
    /// 创建并加固状态目录，绑定当前域名和 ACME directory。
    pub fn prepare(config: &AcmeConfig) -> anyhow::Result<Self> {
        let state_dir = PathBuf::from(&config.state_dir);
        fs::create_dir_all(&state_dir)
            .with_context(|| format!("创建 ACME 状态目录 {} 失败", state_dir.display()))?;
        fs::set_permissions(&state_dir, fs::Permissions::from_mode(0o700))
            .with_context(|| format!("设置 ACME 状态目录 {} 权限失败", state_dir.display()))?;
        Ok(Self {
            domain: config.domain.clone(),
            directory_url: config.directory_url.clone(),
            account_path: state_dir.join("account.json"),
            certificate_path: state_dir.join("certificate.json"),
        })
    }

    /// 加载与当前域名和 ACME directory 匹配的证书 bundle。
    pub fn load_certificate(&self) -> anyhow::Result<Option<(Vec<u8>, Vec<u8>)>> {
        let bytes = match fs::read(&self.certificate_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "读取 ACME 证书状态 {} 失败",
                        self.certificate_path.display()
                    )
                });
            }
        };
        let bundle: PersistedCertificate =
            serde_json::from_slice(&bytes).context("解析 ACME 证书状态失败")?;
        if bundle.domain != self.domain || bundle.directory_url != self.directory_url {
            warn!(
                stored_domain = %bundle.domain,
                configured_domain = %self.domain,
                stored_directory = %bundle.directory_url,
                configured_directory = %self.directory_url,
                "ACME 证书状态与当前签发配置不一致，将忽略旧证书并重新签发"
            );
            return Ok(None);
        }
        Ok(Some((
            bundle.fullchain_pem.into_bytes(),
            bundle.private_key_pem.into_bytes(),
        )))
    }

    async fn load_account(&self) -> anyhow::Result<Option<AccountCredentials>> {
        let bytes = match tokio::fs::read(&self.account_path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("读取 ACME 账户状态 {} 失败", self.account_path.display())
                });
            }
        };
        let persisted: PersistedAccount =
            serde_json::from_slice(&bytes).context("解析 ACME 账户状态失败")?;
        if persisted.directory_url != self.directory_url {
            warn!(
                old = %persisted.directory_url,
                new = %self.directory_url,
                "ACME directory 已变化，将为新目录创建独立账户"
            );
            return Ok(None);
        }
        Ok(Some(persisted.credentials))
    }

    async fn save_account(&self, credentials: AccountCredentials) -> anyhow::Result<()> {
        let bytes = serde_json::to_vec(&PersistedAccount {
            directory_url: self.directory_url.clone(),
            credentials,
        })
        .context("序列化 ACME 账户状态失败")?;
        write_atomic(self.account_path.clone(), bytes, 0o600).await
    }

    async fn save_certificate(
        &self,
        fullchain_pem: String,
        private_key_pem: String,
    ) -> anyhow::Result<()> {
        let bytes = serde_json::to_vec(&PersistedCertificate {
            domain: self.domain.clone(),
            directory_url: self.directory_url.clone(),
            fullchain_pem,
            private_key_pem,
        })
        .context("序列化 ACME 证书状态失败")?;
        write_atomic(self.certificate_path.clone(), bytes, 0o600).await
    }
}

async fn write_atomic(path: PathBuf, bytes: Vec<u8>, mode: u32) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || write_atomic_sync(&path, &bytes, mode))
        .await
        .context("等待 ACME 状态持久化任务失败")?
}

fn write_atomic_sync(path: &Path, bytes: &[u8], mode: u32) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("ACME 状态路径缺少父目录: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow::anyhow!("ACME 状态文件名无效: {}", path.display()))?;
    let temporary_path = parent.join(format!(".{file_name}.next"));

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(&temporary_path)
        .with_context(|| format!("创建 ACME 临时状态 {} 失败", temporary_path.display()))?;
    file.set_permissions(fs::Permissions::from_mode(mode))
        .with_context(|| format!("设置 ACME 临时状态 {} 权限失败", temporary_path.display()))?;
    file.write_all(bytes)
        .with_context(|| format!("写入 ACME 临时状态 {} 失败", temporary_path.display()))?;
    file.sync_all()
        .with_context(|| format!("同步 ACME 临时状态 {} 失败", temporary_path.display()))?;
    fs::rename(&temporary_path, path).with_context(|| {
        format!(
            "原子替换 ACME 状态 {} → {} 失败",
            temporary_path.display(),
            path.display()
        )
    })?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .with_context(|| format!("同步 ACME 状态目录 {} 失败", parent.display()))?;
    Ok(())
}

enum RenewalDecision {
    Issue(Option<CertificateIdentifier<'static>>),
    Wait(Duration),
}

/// Gateway 内建 Let's Encrypt/ACME 生命周期服务。
#[derive(Debug)]
pub struct AcmeService {
    config: AcmeConfig,
    state: AcmeState,
    http_port: u16,
    tls_store: Arc<TlsCertificateStore>,
    challenges: Arc<AcmeChallengeStore>,
}

impl AcmeService {
    /// 创建 ACME 后台生命周期服务。
    pub fn new(
        config: AcmeConfig,
        state: AcmeState,
        http_port: u16,
        tls_store: Arc<TlsCertificateStore>,
        challenges: Arc<AcmeChallengeStore>,
    ) -> Self {
        Self {
            config,
            state,
            http_port,
            tls_store,
            challenges,
        }
    }

    fn account_builder(&self) -> anyhow::Result<AccountBuilder> {
        match self.config.ca_cert_path.as_deref() {
            Some(path) => Account::builder_with_root(path),
            None => Account::builder(),
        }
        .context("创建 ACME HTTP 客户端失败")
    }

    async fn load_or_create_account(&self) -> anyhow::Result<Account> {
        if let Some(credentials) = self.state.load_account().await? {
            return self
                .account_builder()?
                .from_credentials(credentials)
                .await
                .context("恢复 ACME 账户失败");
        }

        let contact = format!("mailto:{}", self.config.email);
        let contacts = [contact.as_str()];
        let (account, credentials) = self
            .account_builder()?
            .create(
                &NewAccount {
                    contact: &contacts,
                    terms_of_service_agreed: true,
                    only_return_existing: false,
                },
                self.config.directory_url.clone(),
                None,
            )
            .await
            .context("创建 ACME 账户失败")?;
        self.state.save_account(credentials).await?;
        info!("✅ ACME 账户已创建并持久化");
        Ok(account)
    }

    async fn wait_for_http_listener(&self, shutdown: &mut ShutdownWatch) -> bool {
        loop {
            let connection = tokio::select! {
                _ = shutdown.changed() => return true,
                connection = TcpStream::connect(("127.0.0.1", self.http_port)) => connection,
            };
            if connection.is_ok() {
                debug!(port = self.http_port, "ACME 已确认 HTTP-01 监听端口就绪");
                return false;
            }
            if wait_or_shutdown(shutdown, LISTENER_READINESS_RETRY_DELAY).await {
                return true;
            }
        }
    }

    async fn maintain_certificate(&self, account: &Account) -> anyhow::Result<Duration> {
        let Some(certificate_der) = self.tls_store.leaf_certificate_der()? else {
            self.issue_certificate(account, None).await?;
            return Ok(Duration::from_secs(self.config.check_interval_secs));
        };

        match self.evaluate_renewal(account, &certificate_der).await? {
            RenewalDecision::Issue(replacement) => {
                self.issue_certificate(account, replacement).await?;
                Ok(Duration::from_secs(self.config.check_interval_secs))
            }
            RenewalDecision::Wait(delay) => {
                debug!(
                    next_check_secs = delay.as_secs(),
                    "ACME 证书尚未进入续期时间"
                );
                Ok(delay)
            }
        }
    }

    async fn evaluate_renewal(
        &self,
        account: &Account,
        certificate_der: &[u8],
    ) -> anyhow::Result<RenewalDecision> {
        let certificate = CertificateDer::from(certificate_der.to_vec());
        if let Ok(identifier) = CertificateIdentifier::try_from(&certificate) {
            let identifier = identifier.into_owned();
            match account.renewal_info(&identifier).await {
                Ok((renewal_info, retry_after)) => {
                    let renew_at =
                        select_renewal_time(&renewal_info.suggested_window, certificate_der);
                    let now = OffsetDateTime::now_utc();
                    if now >= renew_at {
                        return Ok(RenewalDecision::Issue(Some(identifier)));
                    }
                    return Ok(RenewalDecision::Wait(floor_delay(std::cmp::min(
                        retry_after,
                        duration_until(now, renew_at),
                    ))));
                }
                Err(instant_acme::Error::Unsupported(_)) => {
                    debug!("ACME 服务端不支持 ARI，回退到证书实际生命周期");
                }
                Err(error) => {
                    warn!("获取 ACME ARI 续期窗口失败，回退到证书实际生命周期: {error}");
                }
            }
        } else {
            debug!("当前证书无法生成 ARI 标识，回退到证书实际生命周期");
        }

        fallback_renewal_evaluation(
            certificate_der,
            Duration::from_secs(self.config.check_interval_secs),
        )
    }

    async fn issue_certificate(
        &self,
        account: &Account,
        replacement: Option<CertificateIdentifier<'static>>,
    ) -> anyhow::Result<()> {
        info!(domain = %self.config.domain, "开始执行 ACME HTTP-01 签发/续期");
        let identifiers = [Identifier::Dns(self.config.domain.clone())];
        let order_request = match replacement {
            Some(identifier) => NewOrder::new(&identifiers).replaces(identifier),
            None => NewOrder::new(&identifiers),
        };
        let mut order = account
            .new_order(&order_request)
            .await
            .context("创建 ACME order 失败")?;

        let mut challenge_leases = Vec::new();
        {
            let mut authorizations = order.authorizations();
            while let Some(result) = authorizations.next().await {
                let mut authorization = result.context("读取 ACME authorization 失败")?;
                match authorization.status {
                    AuthorizationStatus::Valid => continue,
                    AuthorizationStatus::Pending => {}
                    status => bail!("ACME authorization 状态不可签发: {status:?}"),
                }

                let mut challenge = authorization
                    .challenge(ChallengeType::Http01)
                    .ok_or_else(|| anyhow::anyhow!("ACME 服务端未提供 HTTP-01 challenge"))?;
                let token = challenge.token.clone();
                let key_authorization = challenge.key_authorization().as_str().to_string();
                challenge_leases.push(
                    self.challenges
                        .install(token, key_authorization)
                        .context("发布 HTTP-01 challenge 失败")?,
                );
                challenge
                    .set_ready()
                    .await
                    .context("通知 ACME 服务端验证 challenge 失败")?;
            }
        }

        let order_status = order
            .poll_ready(&RetryPolicy::default())
            .await
            .context("等待 ACME order 验证失败")?;
        drop(challenge_leases);
        if order_status != OrderStatus::Ready {
            bail!("ACME order 未进入 Ready 状态: {order_status:?}");
        }

        let private_key_pem = order.finalize().await.context("提交 ACME CSR 失败")?;
        let fullchain_pem = order
            .poll_certificate(&RetryPolicy::default())
            .await
            .context("下载 ACME 证书链失败")?;

        TlsCertificateStore::from_pem(fullchain_pem.as_bytes(), private_key_pem.as_bytes())
            .context("ACME 返回的证书链与私钥校验失败")?;
        self.state
            .save_certificate(fullchain_pem.clone(), private_key_pem.clone())
            .await?;
        match self
            .tls_store
            .install_pem(fullchain_pem.as_bytes(), private_key_pem.as_bytes())?
        {
            TlsReloadOutcome::Loaded => {
                info!(domain = %self.config.domain, "✅ ACME 证书已持久化并原子热加载");
            }
            TlsReloadOutcome::Unchanged => {
                info!(domain = %self.config.domain, "ACME 返回证书与当前快照一致");
            }
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl BackgroundService for AcmeService {
    async fn start(&self, mut shutdown: ShutdownWatch) {
        if self.wait_for_http_listener(&mut shutdown).await {
            return;
        }

        let mut retry_delay = ACME_MIN_RETRY_DELAY;
        let account = loop {
            let result = tokio::select! {
                _ = shutdown.changed() => return,
                result = self.load_or_create_account() => result,
            };
            match result {
                Ok(account) => break account,
                Err(error) => {
                    warn!(
                        retry_secs = retry_delay.as_secs(),
                        "初始化 ACME 账户失败，将重试: {error:#}"
                    );
                    if wait_or_shutdown(&mut shutdown, retry_delay).await {
                        return;
                    }
                    retry_delay = next_retry_delay(retry_delay);
                }
            }
        };

        retry_delay = ACME_MIN_RETRY_DELAY;
        loop {
            let result = tokio::select! {
                _ = shutdown.changed() => return,
                result = self.maintain_certificate(&account) => result,
            };
            let next_delay = match result {
                Ok(delay) => {
                    retry_delay = ACME_MIN_RETRY_DELAY;
                    delay
                }
                Err(error) => {
                    warn!(
                        retry_secs = retry_delay.as_secs(),
                        "ACME 证书生命周期任务失败，保留当前 TLS 快照并重试: {error:#}"
                    );
                    let delay = retry_delay;
                    retry_delay = next_retry_delay(retry_delay);
                    delay
                }
            };
            if wait_or_shutdown(&mut shutdown, next_delay).await {
                return;
            }
        }
    }
}

async fn wait_or_shutdown(shutdown: &mut ShutdownWatch, delay: Duration) -> bool {
    tokio::select! {
        _ = shutdown.changed() => true,
        _ = tokio::time::sleep(delay) => false,
    }
}

fn next_retry_delay(current: Duration) -> Duration {
    std::cmp::min(current.saturating_mul(2), ACME_MAX_RETRY_DELAY)
}

fn floor_delay(delay: Duration) -> Duration {
    std::cmp::max(delay, MIN_SCHEDULE_DELAY)
}

fn duration_until(now: OffsetDateTime, target: OffsetDateTime) -> Duration {
    u64::try_from((target - now).whole_seconds())
        .map(Duration::from_secs)
        .unwrap_or(Duration::ZERO)
}

fn select_renewal_time(window: &SuggestedWindow, certificate_der: &[u8]) -> OffsetDateTime {
    let span_seconds = (window.end - window.start).whole_seconds();
    if span_seconds <= 0 {
        return window.start;
    }

    let digest = Sha256::digest(certificate_der);
    let sample = u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 长度恒定"));
    let offset = (u128::from(u64::try_from(span_seconds).expect("已验证为正数"))
        * u128::from(sample)
        / u128::from(u64::MAX)) as i64;
    window.start + time::Duration::seconds(offset)
}

fn fallback_renewal_evaluation(
    certificate_der: &[u8],
    maximum_check_interval: Duration,
) -> anyhow::Result<RenewalDecision> {
    let (_, certificate) =
        X509Certificate::from_der(certificate_der).map_err(|error| anyhow::anyhow!(error))?;
    let not_before = certificate.validity().not_before.timestamp();
    let not_after = certificate.validity().not_after.timestamp();
    if not_after <= not_before {
        bail!("TLS 证书有效期区间无效");
    }

    let renew_at = not_before + (not_after - not_before) * 2 / 3;
    let now = OffsetDateTime::now_utc().unix_timestamp();
    if now >= renew_at {
        return Ok(RenewalDecision::Issue(None));
    }
    let until_renewal = u64::try_from(renew_at - now)
        .map(Duration::from_secs)
        .unwrap_or(Duration::ZERO);
    Ok(RenewalDecision::Wait(floor_delay(std::cmp::min(
        until_renewal,
        maximum_check_interval,
    ))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let id = TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "auth-sso-gateway-acme-test-{}-{id}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn challenge_store_only_returns_exact_safe_token() {
        let store = Arc::new(AcmeChallengeStore::new());
        let lease = store
            .install("abc_DEF-123".to_string(), "proof".to_string())
            .unwrap();

        assert_eq!(
            store.response_for_path("/.well-known/acme-challenge/abc_DEF-123"),
            Some(Bytes::from_static(b"proof"))
        );
        assert_eq!(
            store.response_for_path("/.well-known/acme-challenge/../../secret"),
            None
        );
        assert_eq!(
            store.response_for_path("/.well-known/acme-challenge/other"),
            None
        );
        assert!(
            store
                .install("../escape".to_string(), "proof".to_string())
                .is_err()
        );
        drop(lease);
        assert_eq!(
            store.response_for_path("/.well-known/acme-challenge/abc_DEF-123"),
            None
        );
    }

    #[test]
    fn ari_selection_is_stable_and_inside_window() {
        let window = SuggestedWindow {
            start: OffsetDateTime::from_unix_timestamp(1_000).unwrap(),
            end: OffsetDateTime::from_unix_timestamp(2_000).unwrap(),
        };
        let first = select_renewal_time(&window, b"certificate");
        let second = select_renewal_time(&window, b"certificate");
        assert_eq!(first, second);
        assert!(first >= window.start);
        assert!(first <= window.end);
    }

    #[tokio::test]
    async fn certificate_bundle_is_atomic_and_issuance_configuration_bound() {
        let directory = TestDir::new();
        let config = AcmeConfig {
            domain: "sso.example.com".to_string(),
            email: "ops@example.com".to_string(),
            state_dir: directory.0.to_string_lossy().into_owned(),
            ..AcmeConfig::default()
        };
        let state = AcmeState::prepare(&config).unwrap();
        assert!(state.load_certificate().unwrap().is_none());
        assert_eq!(
            fs::metadata(&directory.0).unwrap().permissions().mode() & 0o777,
            0o700
        );

        state
            .save_certificate("certificate".to_string(), "private-key".to_string())
            .await
            .unwrap();
        assert_eq!(
            state.load_certificate().unwrap(),
            Some((b"certificate".to_vec(), b"private-key".to_vec()))
        );
        assert_eq!(
            fs::metadata(&state.certificate_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        let changed_directory = AcmeConfig {
            directory_url: "https://acme-staging-v02.api.letsencrypt.org/directory".to_string(),
            ..config
        };
        let changed_state = AcmeState::prepare(&changed_directory).unwrap();
        assert!(changed_state.load_certificate().unwrap().is_none());
    }
}

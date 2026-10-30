# systemd 运维定时任务

把本目录复制到客户服务器 `/etc/systemd/system/`，按实际路径修改：

- `WorkingDirectory` 默认 `/opt/auth-sso`
- `EnvironmentFile=/etc/auth-sso/backup.env`：

```bash
ENV_FILE=/opt/auth-sso/.env.prod
COMPOSE_FILE=docker/compose/prod.yml
BACKUP_DIR=/opt/auth-sso/backups
# 建议启用加密，密钥单独存放
BACKUP_ENCRYPTION_KEY_FILE=/etc/auth-sso/backup.key
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now auth-sso-backup.timer
sudo systemctl enable --now auth-sso-partitions.timer
systemctl list-timers 'auth-sso-*'
```

验证一次：

```bash
sudo systemctl start auth-sso-backup.service
sudo journalctl -u auth-sso-backup.service -n 50
```

`auth-sso-partitions.service` 依赖 `apps/portal/scripts/maintain-access-log-partitions.ts`：
预创建未来 2 个月分区，并删除超过 180 天的 `access_logs` 分区。`audit_logs`/`login_logs` 的长期归档仍不在当前实现内。

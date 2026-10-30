# 可观测性交付模板

这里只提供**可复用的抓取与告警配置**，不绑定客户监控平台。

## 前置

1. Gateway 配置 `GATEWAY_METRICS_TOKEN`（≥16 字符，建议 `openssl rand -hex 32`）；
2. 把 token 写入 Prometheus 宿主的 `gateway-metrics-token` 文件（权限 600）；
3. 将 `prometheus.yml` 中的 `<domain>` 替换为真实域名；
4. 自签/内部 CA 验收环境才启用 `tls_config.insecure_skip_verify` 或 `ca_file`。

## 启动示例

```bash
docker run --rm -p 9090:9090 \
  -v "$PWD/deploy/observability:/etc/prometheus:ro" \
  -v "$PWD/gateway-metrics-token:/etc/prometheus/gateway-metrics-token:ro" \
  prom/prometheus:v3.5.0 \
  --config.file=/etc/prometheus/prometheus.yml
```

`alerts.yml` 是模板，需接入客户 Alertmanager/云监控的 receiver；仓库不包含通知凭证。

## 验收

```bash
curl -fsS -H "Authorization: Bearer $GATEWAY_METRICS_TOKEN" \
  https://<domain>/__gateway/metrics | head
```

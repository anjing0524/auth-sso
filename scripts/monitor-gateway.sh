#!/bin/bash

# ==============================================================================
# 脚本名称: monitor-gateway.sh
# 脚本功能: 实时监控 Pingora 网关容器状态，检测到异常挂掉(die)时进行终端报警与 Webhook 告警推送
# 约束说明: 必须在 Docker 宿主机环境下运行，需拥有执行 docker 命令的权限
# ==============================================================================

# 监控的目标容器名称
CONTAINER_NAME="auth-sso-gateway"

# 告警 Webhook 地址 (支持飞书、钉钉等，在此处留空，由运维人员后续填入)
# 例如: ALERT_WEBHOOK="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxx"
ALERT_WEBHOOK=""

# ------------------------------------------------------------------------------
# 函数名称: send_alert
# 函数功能: 触发 Webhook 告警推送
# 参数列表: $1 - 告警消息内容
# 返回值: 无
# ------------------------------------------------------------------------------
send_alert() {
    local message="$1"
    local local_time
    local_time=$(date "+%Y-%m-%d %H:%M:%S")

    # 1. 终端输出红色告警
    echo -e "\033[31m[🚨 告警 - ${local_time}] ${message}\033[0m"

    # 2. 如果配置了 Webhook，则发送 JSON 请求到告警机器人
    if [ -n "${ALERT_WEBHOOK}" ]; then
        echo "正在发送 Webhook 告警..."
        # 默认使用飞书卡片格式，或简单纯文本
        curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"🚨 SSO 统一身份认证系统告警\\n时间: ${local_time}\\n详情: ${message}\"}}" \
            "${ALERT_WEBHOOK}" > /dev/null
    else
        echo -e "\033[33m提示: 未配置 ALERT_WEBHOOK，跳过 Webhook 告警发送。如需启用，请编辑本脚本配置。\033[0m"
    fi
}

# ------------------------------------------------------------------------------
# 主函数入口
# ------------------------------------------------------------------------------
main() {
    echo -e "\033[32m[INFO] 开始启动 Pingora 信创网关容器监控...\033[0m"
    echo -e "[INFO] 正在监听容器 [${CONTAINER_NAME}] 的事件..."

    # 使用 docker events 实时监听目标容器的 die (死亡/退出) 事件
    # --filter container= 过滤指定容器
    # --filter event=die 过滤退出事件
    # --format '{{.Time}}' 自定义输出时间格式
    docker events --filter "container=${CONTAINER_NAME}" --filter "event=die" --format "{{.Time}} {{.ID}} {{.Actor.Attributes.name}}" | while read -r event_time container_id name; do
        
        # 转换 Unix 时间戳为可读时间
        local friendly_time
        friendly_time=$(date -r "${event_time}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -d "@${event_time}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "${event_time}")

        # 检查容器退出的退出码 (ExitCode)
        local exit_code
        exit_code=$(docker inspect "${container_id}" --format='{{.State.ExitCode}}' 2>/dev/null || echo "未知")

        # 检查容器崩溃原因 (OOMKilled 等)
        local oom_killed
        oom_killed=$(docker inspect "${container_id}" --format='{{.State.OOMKilled}}' 2>/dev/null || echo "false")

        local details="Pingora 网关容器已停止运行！"
        if [ "${oom_killed}" = "true" ]; then
            details="Pingora 网关容器发生 OOM (内存溢出) 崩溃！"
        else
            details="Pingora 网关容器异常退出，退出码 (ExitCode): ${exit_code}。"
        fi

        # 发送综合告警
        send_alert "【生产高急】服务网关崩溃！服务: ${name} (ID: ${container_id:0:12}), 时间: ${friendly_time}, 详情: ${details}"
    done
}

# 运行主程序
main

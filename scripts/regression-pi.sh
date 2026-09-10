#!/usr/bin/env bash
# T12b pi 升级四项冒烟(dev-process §4 L4:pi 换版本必过)
#
# 用途:在隔离 env 中跑通一轮 pi --mode rpc,四项断言覆盖升级后的协议兼容面:
#   ① RPC 握手   —— get_state 收到 success 响应;
#   ② 事件流      —— prompt("回复 ok") 收到 text_delta 且收到 agent_settled;
#   ③ 会话持久    —— 隔离 sessions/ 出现会话 JSONL,且含消息行(简化版);
#   ④ abort 生效  —— 发长任务 prompt 后 1s 发 abort,收到 agent_end 且此后无继续输出。
#
# 参数:PI_BIN 环境变量覆盖 pi 可执行文件(默认从 PATH 查找)。
# 隔离:全程只读全局 ~/.pi;对话在 mktemp -d 的临时 dataDir 中,退出时 trap 清理。
# 退出码:任一项 FAIL → 1;SKIP(如本机无可用模型)不计失败。
set -euo pipefail

PASS=0; FAIL=0; SKIP=0

# ---------- 定位 pi 可执行文件 ----------
PI_BIN="${PI_BIN:-$(command -v pi 2>/dev/null || true)}"
if [ -z "$PI_BIN" ] || [ ! -x "$PI_BIN" ]; then
  echo "[FAIL] 前置检查:找不到 pi(请设置 PI_BIN 或将其加入 PATH)" >&2
  exit 1
fi
PI_VER="$("$PI_BIN" --version 2>/dev/null | tail -1 || true)"
echo "[前置] PI_BIN=$PI_BIN 版本=${PI_VER:-未知}"

# env -i 极简执行用的 PATH:pi 目录 + node 目录 + 系统基础目录
NODE_BIN_DIR="$(dirname "$(command -v node 2>/dev/null || echo /usr/local/bin/node)")"
ISO_PATH="$NODE_BIN_DIR:$(dirname "$PI_BIN"):/usr/local/bin:/usr/bin:/bin"

# ---------- 隔离 dataDir 与清理 ----------
DATA_DIR="$(mktemp -d /tmp/pidesk-regress.XXXXXX)"
PI_AGENT_DIR="$DATA_DIR/pi-agent"
PI_SESS_DIR="$PI_AGENT_DIR/sessions"
mkdir -p "$PI_SESS_DIR"

# 最小 settings + Ollama 预置 models.json(模型动态探测;Ollama 不可用则对话类断言降级 SKIP)
HAS_MODEL=0
OLLAMA_MODEL="$(curl -s --max-time 3 localhost:11434/api/tags 2>/dev/null \
  | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
if [ -n "$OLLAMA_MODEL" ]; then
  HAS_MODEL=1
  cat > "$PI_AGENT_DIR/models.json" <<EOF
{"providers":{"ollama-local":{"name":"ollama-local","baseUrl":"http://localhost:11434/v1","api":"openai-completions","apiKey":"ollama","compat":{"supportsDeveloperRole":false,"supportsReasoningEffort":false},"models":[{"id":"$OLLAMA_MODEL","name":"$OLLAMA_MODEL","input":["text"],"contextWindow":65536,"maxTokens":8192}]}}}
EOF
  printf '{"defaultProjectTrust":"never","defaultProvider":"ollama-local","defaultModel":"%s"}\n' "$OLLAMA_MODEL" > "$PI_AGENT_DIR/settings.json"
else
  printf '{ "defaultProjectTrust": "never" }\n' > "$PI_AGENT_DIR/settings.json"
fi

PI_PID=""
cleanup() {
  [ -n "$PI_PID" ] && kill "$PI_PID" 2>/dev/null || true
  exec 3>&- 2>/dev/null || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

report() { # report <PASS|FAIL|SKIP> <标签> <一句话原因>
  local st=$1 tag=$2 msg=$3
  printf '[%s] %s %s\n' "$st" "$tag" "$msg"
  case "$st" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP) SKIP=$((SKIP + 1)) ;;
  esac
}

# ---------- 等待 stdout 出现指定帧(0.25s 一档,超时返回 1) ----------
wait_frame() { # $1=输出文件 $2=grep 模式 $3=超时档数
  local file=$1 pat=$2 limit=$3 waited=0
  while [ "$waited" -lt "$limit" ]; do
    grep -q -- "$pat" "$file" 2>/dev/null && return 0
    kill -0 "$PI_PID" 2>/dev/null || return 1   # 进程已退出,不必再等
    sleep 0.25
    waited=$((waited + 1))
  done
  grep -q -- "$pat" "$file" 2>/dev/null
}

# ---------- 启动隔离 pi --mode rpc ----------
RPC_OUT="$DATA_DIR/rpc-out.jsonl"
RPC_ERR="$DATA_DIR/rpc-err.log"
IN_FIFO="$DATA_DIR/in.fifo"
mkfifo "$IN_FIFO"

env -i PATH="$ISO_PATH" \
    PI_CODING_AGENT_DIR="$PI_AGENT_DIR" \
    PI_CODING_AGENT_SESSION_DIR="$PI_SESS_DIR" \
    "$PI_BIN" --mode rpc < "$IN_FIFO" > "$RPC_OUT" 2> "$RPC_ERR" &
PI_PID=$!
exec 3<>"$IN_FIFO"   # O_RDWR:不阻塞且保持写端直到显式关闭
send() { printf '%s\n' "$1" >&3 2>/dev/null || true; }

# ---------- ① RPC 握手:get_state → success ----------
STATE_OK=0
send '{"id":"reg-state","type":"get_state"}'
if wait_frame "$RPC_OUT" '"command":"get_state"' 40 \
   && grep -q '"command":"get_state","success":true' "$RPC_OUT"; then
  STATE_OK=1
  report PASS "①RPC握手" "get_state 收到 success 响应"
else
  report FAIL "①RPC握手" "get_state 未收到 success 响应(见 $RPC_ERR 尾部)"
  tail -5 "$RPC_ERR" >&2 || true
fi

# ---------- ② prompt 事件流:text_delta + agent_settled ----------
if [ "$STATE_OK" -eq 0 ]; then
  report FAIL "②事件流" "前置 RPC 未握手成功,无法验证事件流"
elif [ "$HAS_MODEL" -eq 0 ]; then
  report SKIP "②事件流" "本机 Ollama 不可达,无法发起真实对话轮——手动补验"
else
  send '{"id":"reg-prompt","type":"prompt","message":"回复 ok"}'
  GOT_DELTA=0; GOT_SETTLED=0
  wait_frame "$RPC_OUT" '"type":"text_delta"' 240 && GOT_DELTA=1   # 60s
  wait_frame "$RPC_OUT" '"type":"agent_settled"' 240 && GOT_SETTLED=1
  if [ "$GOT_DELTA" -eq 1 ] && [ "$GOT_SETTLED" -eq 1 ]; then
    report PASS "②事件流" "收到 text_delta 流式文本与 agent_settled 空闲信号"
  else
    report FAIL "②事件流" "text_delta=${GOT_DELTA} agent_settled=${GOT_SETTLED}(期待均为 1)"
  fi
fi

# ---------- ③ 会话持久:隔离区 JSONL 存在且含消息行(简化版) ----------
SESSION_FILE="$(grep -o '"sessionFile":"[^"]*"' "$RPC_OUT" 2>/dev/null | head -1 | cut -d'"' -f4 || true)"
JSONL_COUNT="$(find "$PI_SESS_DIR" -type f -name '*.jsonl' 2>/dev/null | wc -l)"
if [ "$HAS_MODEL" -eq 0 ]; then
  report SKIP "③会话持久" "本机 Ollama 不可达,无对话轮则无消息行——手动补验"
elif [ -n "$SESSION_FILE" ] && [ "${SESSION_FILE#"$DATA_DIR"}" != "$SESSION_FILE" ] \
     && [ -f "$SESSION_FILE" ] && grep -q '"role":' "$SESSION_FILE" 2>/dev/null; then
  report PASS "③会话持久" "隔离区出现 ${JSONL_COUNT} 个 JSONL,会话文件含消息行(${SESSION_FILE})"
else
  report FAIL "③会话持久" "隔离区未见含消息行的会话 JSONL(sessionFile=${SESSION_FILE:-空})"
fi

# ---------- ④ abort 生效:长任务 → 1s 后 abort → agent_end 且无继续输出 ----------
if [ "$STATE_OK" -eq 0 ]; then
  report FAIL "④abort生效" "前置 RPC 未握手成功,无法验证 abort"
elif [ "$HAS_MODEL" -eq 0 ]; then
  report SKIP "④abort生效" "本机 Ollama 不可达,无法发起长任务——手动补验"
else
  send '{"id":"reg-long","type":"prompt","message":"数到 100000,每行一个数"}'
  sleep 1
  send '{"id":"reg-abort","type":"abort"}'
  GOT_END=0
  wait_frame "$RPC_OUT" '"type":"agent_end"' 240 && GOT_END=1   # 60s
  # abort 响应可能晚于 agent_end 到达,先等它落盘再测“无继续输出”
  wait_frame "$RPC_OUT" '"command":"abort"' 40 || true          # 最多再等 10s
  if [ "$GOT_END" -eq 1 ]; then
    L1="$(wc -l < "$RPC_OUT")"
    sleep 2
    L2="$(wc -l < "$RPC_OUT")"
    if [ "$L1" = "$L2" ]; then
      report PASS "④abort生效" "abort 后收到 agent_end,2s 内无新增输出(稳定 ${L2} 行)"
    else
      report FAIL "④abort生效" "abort 后仍有输出(2s 内 ${L1}→${L2} 行)"
    fi
  else
    report FAIL "④abort生效" "abort 未生效:60s 内未收到 agent_end"
  fi
fi

# ---------- 收尾:关闭 stdin → 优雅退出 ----------
exec 3>&- 2>/dev/null || true
wait "$PI_PID" 2>/dev/null || true
PI_PID=""

echo "pi 升级冒烟:${PASS} PASS ${SKIP} SKIP ${FAIL} FAIL"
[ "$FAIL" -eq 0 ]

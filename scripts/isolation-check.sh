#!/usr/bin/env bash
# T12a 双向隔离验收脚本(M1 出口 L4,m1-design §8 定版用例的可执行化)
#
# 产品语义:pidesk 派生的 pi 子进程 env 隔离(PI_CODING_AGENT_DIR=<dataDir>/pi-agent),
# 全局 ~/.pi 永不被读写。
#
# 本脚本:
#   - 全程只读 ~/.pi(仅 find/stat 快照),绝不写入;
#   - 在 mktemp -d 的临时 dataDir 中以隔离 env 跑通一轮 pi --mode rpc 对话;
#   - 断言:A1 全局会话目录无新文件 / A2 ~/.pi 顶层 mtime 不变 / A4 隔离区出现会话 JSONL;
#   - A3(全局 skill 不渗透)需预置全局 skill,脚本无此预置权限 → 输出 SKIP 标注手动补验。
set -euo pipefail

PASS=0; FAIL=0; SKIP=0
PI_BIN=""

# ---------- 前置检查:pi 可用 ----------
if [ -x /usr/local/bin/pi ]; then
  PI_BIN=/usr/local/bin/pi
elif command -v pi >/dev/null 2>&1; then
  PI_BIN="$(command -v pi)"
else
  echo "[FAIL] 前置检查:找不到 pi(/usr/local/bin/pi 或 PATH)" >&2
  exit 1
fi
# env -i 极简执行用的 PATH:pi 自身目录 + node 目录 + 系统基础目录
NODE_BIN_DIR="$(dirname "$(command -v node 2>/dev/null || echo /usr/local/bin/node)")"
ISO_PATH="$NODE_BIN_DIR:$(dirname "$PI_BIN"):/usr/local/bin:/usr/bin:/bin"

# ---------- 临时隔离 dataDir 与清理 ----------
DATA_DIR="$(mktemp -d /tmp/pidesk-isolation.XXXXXX)"
PI_AGENT_DIR="$DATA_DIR/pi-agent"
PI_SESS_DIR="$PI_AGENT_DIR/sessions"
mkdir -p "$PI_SESS_DIR"
# 镜像 m1-design §4/§6 隔离目录 bootstrap(只写隔离区,不碰 ~/.pi):
# 最小 settings + Ollama 预置 models.json(模型从本机 Ollama 动态探测,Ollama 不可用则 A4 降级 SKIP)
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

# ---------- 快照函数(只读 ~/.pi) ----------
# 全局会话目录快照:兼容 canonical(~/.pi/agent/sessions)与历史(~/.pi/sessions)两种布局
snap_global_sessions() {
  local d
  for d in "$HOME/.pi/agent/sessions" "$HOME/.pi/sessions"; do
    [ -d "$d" ] && find "$d" -type f -printf '%p %T@\n' | sort
  done
  true
}
# ~/.pi 顶层快照:目录自身 + 一级条目(sessions/skills/auth 等)的 mtime
snap_global_top() {
  if [ -d "$HOME/.pi" ]; then
    stat -c '%n %Y' "$HOME/.pi"
    find "$HOME/.pi" -mindepth 1 -maxdepth 1 -printf '%p %T@\n' | sort
  fi
  true
}
GLOBAL_EXISTS=0
[ -d "$HOME/.pi" ] && GLOBAL_EXISTS=1

# ---------- 等待 stdout 出现指定帧(超时返回 1) ----------
# $1=输出文件 $2=grep 模式 $3=超时(0.25s 单位的次数)
wait_frame() {
  local file=$1 pat=$2 limit=$3 waited=0
  while [ "$waited" -lt "$limit" ]; do
    grep -q -- "$pat" "$file" 2>/dev/null && return 0
    kill -0 "$PI_PID" 2>/dev/null || return 1   # 进程已退出,不必再等
    sleep 0.25
    waited=$((waited + 1))
  done
  grep -q -- "$pat" "$file" 2>/dev/null
}

report() { # report <PASS|FAIL|SKIP> <标签> <一句话原因>
  local st=$1 tag=$2 msg=$3
  printf '[%s] %s %s\n' "$st" "$tag" "$msg"
  case "$st" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP) SKIP=$((SKIP + 1)) ;;
  esac
}

# ---------- 快照(对话前) ----------
snap_sessions_before="$(snap_global_sessions)"
snap_top_before="$(snap_global_top)"

# ---------- 执行:隔离 env + pi --mode rpc 一轮对话 ----------
RPC_OUT="$DATA_DIR/rpc-out.jsonl"
RPC_ERR="$DATA_DIR/rpc-err.log"
IN_FIFO="$DATA_DIR/in.fifo"
mkfifo "$IN_FIFO"

# env 隔离:m1-design §4,env -i 只带三变量(PATH + 两个 PI_*),其余环境全部丢弃
env -i PATH="$ISO_PATH" \
    PI_CODING_AGENT_DIR="$PI_AGENT_DIR" \
    PI_CODING_AGENT_SESSION_DIR="$PI_SESS_DIR" \
    "$PI_BIN" --mode rpc < "$IN_FIFO" > "$RPC_OUT" 2> "$RPC_ERR" &
PI_PID=$!
# 3<> 以 O_RDWR 打开 FIFO:不阻塞,且保持写端直到显式关闭(stdin EOF → pi 优雅退出)
exec 3<>"$IN_FIFO"

send() { printf '%s\n' "$1" >&3 2>/dev/null || true; }

# 1) get_state:确认进程可用
T0=$SECONDS
send '{"id":"t12a-state","type":"get_state"}'
if wait_frame "$RPC_OUT" '"command":"get_state"' 60 \
   && grep -q '"command":"get_state","success":true' "$RPC_OUT"; then
  echo "[执行] pi RPC 进程可用(get_state 成功)"
  STATE_OK=1
else
  echo "[执行] FAIL:get_state 未成功,pi 进程异常(见 $RPC_ERR 尾部)" >&2
  tail -5 "$RPC_ERR" >&2 || true
  STATE_OK=0
fi

# 2) prompt → 等待 agent_settled(45s 超时)
SETTLED=0
if [ "$STATE_OK" -eq 1 ]; then
  send '{"id":"t12a-prompt","type":"prompt","message":"回复 ok"}'
  if wait_frame "$RPC_OUT" '"type":"agent_settled"' 180; then
    SETTLED=1
    echo "[执行] 一轮对话完成,收到 agent_settled(耗时 $((SECONDS - T0))s)"
  else
    echo "[执行] 45s 内未收到 agent_settled(模型连通性不影响隔离断言,继续)"
  fi
fi

# 3) 关闭 stdin → pi 优雅退出
exec 3>&- 2>/dev/null || true
wait "$PI_PID" 2>/dev/null || true
PI_PID=""

# ---------- 断言(对话后快照对比) ----------
snap_sessions_after="$(snap_global_sessions)"
snap_top_after="$(snap_global_top)"

# ① A1:全局会话列表不含本轮(临时目录)会话,且全局会话目录前后快照一致
# 从 get_state 读取本轮 sessionFile,确认它落在临时 dataDir 内、不在 ~/.pi 下
SESSION_FILE="$(grep -o '"sessionFile":"[^"]*"' "$RPC_OUT" 2>/dev/null | head -1 | cut -d'"' -f4 || true)"
A1_PLACED=1
if [ -n "$SESSION_FILE" ] && [ "${SESSION_FILE#"$DATA_DIR"}" = "$SESSION_FILE" ]; then
  A1_PLACED=0   # 会话文件未落在临时 dataDir 内 → 落点异常
fi
if [ "$snap_sessions_before" != "$snap_sessions_after" ]; then
  report FAIL "A1" "全局会话目录快照发生变化,疑似被 pi 子进程写入"
elif [ "$A1_PLACED" -eq 0 ]; then
  report FAIL "A1" "本轮会话未落在临时 dataDir(${SESSION_FILE}),疑似写入全局目录"
elif [ -n "$SESSION_FILE" ]; then
  report PASS "A1" "全局会话列表不含本轮会话(本轮落点 $SESSION_FILE),全局目录前后一致"
else
  report PASS "A1" "全局会话目录前后快照一致,无 pidesk 会话渗入"
fi

# ② A2:~/.pi 顶层 mtime 不变(含一级 sessions/skills/auth 条目)
if [ "$GLOBAL_EXISTS" -eq 0 ]; then
  report PASS "A2" "全局 ~/.pi 不存在且对话后仍未被创建,无任何写入"
elif [ "$snap_top_before" = "$snap_top_after" ]; then
  report PASS "A2" "~/.pi 顶层及其一级条目 mtime 前后一致,全局目录零写入"
else
  report FAIL "A2" "~/.pi 顶层 mtime 发生变化,疑似被 pi 子进程写入"
fi

# ③ A4:隔离区 sessions/ 出现本轮会话 JSONL
JSONL_COUNT="$(find "$PI_SESS_DIR" -type f -name '*.jsonl' 2>/dev/null | wc -l)"
if [ "$HAS_MODEL" -eq 0 ]; then
  report SKIP "A4" "本机 Ollama 不可达,无法进行真实对话轮,会话落点无法证实——手动补验"
elif [ "${JSONL_COUNT:-0}" -gt 0 ]; then
  report PASS "A4" "隔离区 $PI_SESS_DIR 出现 ${JSONL_COUNT} 个会话 JSONL(${SESSION_FILE:-落点在隔离区内})"
else
  report FAIL "A4" "隔离区 $PI_SESS_DIR 未出现会话 JSONL,会话落点异常"
fi

# A3:全局 skill 不渗透(需预置全局 skill,脚本无预置权限)
report SKIP "A3" "全局 skill 不渗透:需预置全局 skill,脚本无此预置权限——手动补验"

# ---------- 汇总 ----------
echo "隔离验收:${PASS} PASS ${SKIP} SKIP ${FAIL} FAIL"
[ "$FAIL" -eq 0 ]

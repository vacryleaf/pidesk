#!/usr/bin/env bash
# pidesk 子线程派发器 —— 主线程专用。
# 把「作业纪律 + 环境约束 + 完工标准」机械化注入每次派发,配合验收命令强制子线程自验闭环。
#
# 用法:
#   scripts/dispatch.sh -t "<任务描述>" -v "<验收命令>" [-d <工作目录>] [-c] [-m <模型>]
#     -t  任务描述(必填,自包含:目标/涉及文件路径/约束,关键现状摘要内联,减少子线程探索性读取)
#     -v  验收命令(必填,子线程必须自行跑到通过为止,如 "pnpm -r build && pnpm -r test")
#     -d  工作目录(默认仓库根,由脚本位置自动定位;子线程会话按 cwd 归档)
#     -c  返工模式:续接该工作目录最近的子线程会话(需附具体问题清单与原始报错)
#     -m  模型覆盖(默认 16k):16k | 32k
#         16k = qwen3.8:q3xl-16k(27B,默认;任务卡必须按 16k 上下文预算拆分)
#         32k = qwen3.8:q3xl-32k(27B,任务需中等量文档读取时)
#
# 注意:① 同一工作目录下并行派发会混淆 --continue 的会话归属,请串行派发;
#       ② 模型切换有冷启动(卸载/加载 ~25s+),串行任务尽量同模型;
#       ③ 任务超出 16k 预算的信号:需读第 4 个文件/产出长文件 → 拆卡,不要硬塞导致 compact。

set -euo pipefail

WORKER_PI_DIR="/home/harry/.pi-worker"
MODEL_DEFAULT="ollama/qwen3.8:q3xl-16k"
declare -A MODELS=( [16k]="$MODEL_DEFAULT" [32k]="ollama/qwen3.8:q3xl-32k" [glm]="hanhe/glm-5.3-flash" )

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK="" VERIFY="" CWD="$REPO_ROOT" CONT=0 MKEY="16k"
while getopts "t:v:d:cm:" opt; do
  case $opt in
    t) TASK="$OPTARG" ;;
    v) VERIFY="$OPTARG" ;;
    d) CWD="$OPTARG" ;;
    c) CONT=1 ;;
    m) MKEY="$OPTARG" ;;
    *) grep '^#' "$0" | head -24; exit 1 ;;
  esac
done
[ -n "$TASK" ] && [ -n "$VERIFY" ] || { grep '^#' "$0" | head -24; exit 1; }
[ -n "${MODELS[$MKEY]:-}" ] || { echo "未知模型: $MKEY (可选: 16k | 32k)"; exit 1; }
MODEL="${MODELS[$MKEY]}"

PROMPT="【角色】pidesk 项目开发执行者(WSL2 Linux)。

【纪律】改动必须 write/edit 真实落盘,严禁只贴代码;只动任务卡清单内文件;不新增依赖;注释与回复中文;路径照卡,禁自建/改名;禁 git 操作。
【输出】thinking≤200字,只记动作与结论;长命令一律尾部加 2>&1 | tail -20;禁整读大文件(用 grep/head 取片段)。
【环境】pnpm 必须用 /home/harry/.npm-global/bin/pnpm(PATH 内的 pnpm 可能损坏);pnpm monorepo(apps/ packages/);Node24;Linux;ESM。
【完工硬标】自行跑验收命令至通过(≤5 轮,失败须自修):
     ${VERIFY}
通过后报告:改动文件(逐个一句话)/验收输出摘要/遗留问题;5 轮仍败则如实说明,禁谎报。

【任务】
${TASK}"

cd "$CWD"
# -nc/-ns/-np/--no-themes: 关闭 AGENTS.md/skills/提示词模板/主题发现——子线程上下文预算有限,任务卡自包含,无需这些注入
if [ "$CONT" -eq 1 ]; then
  exec env PI_CODING_AGENT_DIR="$WORKER_PI_DIR" pi -c -p --model "$MODEL" --thinking off -nc -ns -np --no-themes "$PROMPT"
else
  exec env PI_CODING_AGENT_DIR="$WORKER_PI_DIR" pi -p --model "$MODEL" --thinking off -nc -ns -np --no-themes "$PROMPT"
fi

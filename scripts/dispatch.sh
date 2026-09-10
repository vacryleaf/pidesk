#!/usr/bin/env bash
# pidesk 子线程派发器 —— 主线程专用。
# 把「作业纪律 + 环境约束 + 完工标准」机械化注入每次派发,配合验收命令强制子线程自验闭环。
#
# 用法:
#   scripts/dispatch.sh -t "<任务描述>" -v "<验收命令>" [-d <工作目录>] [-c]
#     -t  任务描述(必填,自包含:目标/涉及文件/约束)
#     -v  验收命令(必填,子线程必须自行跑到通过为止,如 "pnpm -r build && pnpm -r test")
#     -d  工作目录(默认 /root/pidesk;子线程会话按 cwd 归档)
#     -c  返工模式:续接该工作目录最近的子线程会话(需附具体问题清单与原始报错)
#
# 注意:同一工作目录下并行派发会混淆 --continue 的会话归属,请串行派发。

set -euo pipefail

WORKER_PI_DIR="/root/.pi-worker"
MODEL="ollama/qwen3.8-9b-coder:128k"

TASK="" VERIFY="" CWD="/root/pidesk" CONT=0
while getopts "t:v:d:c" opt; do
  case $opt in
    t) TASK="$OPTARG" ;;
    v) VERIFY="$OPTARG" ;;
    d) CWD="$OPTARG" ;;
    c) CONT=1 ;;
    *) grep '^#' "$0" | head -20; exit 1 ;;
  esac
done
[ -n "$TASK" ] && [ -n "$VERIFY" ] || { grep '^#' "$0" | head -20; exit 1; }

PROMPT="【角色】你是 pidesk 项目的开发执行者,在 WSL2 的 Linux 环境中工作。

【作业纪律——违反即返工】
1. 所有文件改动必须通过 write/edit 工具真实落盘;严禁只在回复中粘贴代码。
2. 只改任务范围内文件;不引入任务未要求的依赖;不动无关格式。
3. 注释与回复一律中文。
4. 产出路径必须与任务描述完全一致;禁止自建目录、重命名或移动文件。

【环境约束】
- Node v24 可直接运行 .ts(type stripping):ESM import 路径必须带 .ts 扩展名(如 import ... from \"./x.ts\")。
- 包管理器 pnpm;仓库为 pnpm monorepo(apps/ packages/ 结构)。
- Linux 平台,路径大小写敏感;git 操作由主线程负责,禁止 git commit/push。

【完工标准——硬性】
1. 完成后必须自行运行验收命令,确认通过:
     ${VERIFY}
2. 验收失败必须自行修复并重跑,直至通过(最多 5 轮);5 轮仍失败则在报告中如实说明已尝试内容与失败原因,不得谎报完成。
3. 通过后按以下格式报告:
   改动文件: <路径> — <一句话说明>(逐文件)
   验收结果: <命令> → 通过,<输出末尾摘要>
   遗留问题: <无 或 列表>

【任务】
${TASK}"

cd "$CWD"
if [ "$CONT" -eq 1 ]; then
  exec env PI_CODING_AGENT_DIR="$WORKER_PI_DIR" pi -c -p --model "$MODEL" --thinking medium "$PROMPT"
else
  exec env PI_CODING_AGENT_DIR="$WORKER_PI_DIR" pi -p --model "$MODEL" --thinking medium "$PROMPT"
fi

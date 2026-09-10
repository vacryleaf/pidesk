# M1 任务卡(m1-tasks v2.0)

> 2026-09-10。前置:pi-protocol v1.0、m1-design v1.0(均过环节一)。
> **v2.0 修订(用户指示)**:剩余全部卡 16k 模型;拆分至最小粒度(原 T2/T5/T7/T8/T9/T10/T11/T12/T13 均再拆)。
> 用途:主线程派发手册。每卡按 16k 预算拆分,派发时将「内联要点」所引章节文本直接贴进 `-t` 描述;`-v` 验收命令原样传入 dispatch.sh。

---

## 0. 派发纪律(v2.0)

- **串行派发**按序号;子线程禁 git、禁新增依赖;依赖白名单 = m1-design §1。
- **预消化纪律**:每卡「前置(主线程)」段由主线程在派发前完成(版本实查写死、配置样板备好、环境验证);子线程卡只含"写码 + 单次验收"。
- **内联纪律**:派发时把「要点内联源」章节原文贴进任务卡;子线程禁读 docs。
- **输出纪律**:验收命令一律 `2>&1 | tail -N` 截断。
- **不拆说明**:T4(rpc-client)、T6(pi-process)为强内聚单文件状态机/协议件,硬拆反而制造接口协调面,维持单卡 16k(要点已可内联,无需读文档)。

## 派发序列总表(26 卡)

| 卡 | 名称 | 依赖 | 前置(主线程) | 核心产出 |
|----|------|------|--------------|----------|
| T1 ✅ | workspace 根 + shared | — | install/台账 | `5e1e6bb` 已合入 |
| T2a | ui 包底座与设计令牌 | T1 | tailwind4/vite 配对实查 | tailwind 配置、tokens.css |
| T2b | desktop 三进程壳 | T2a | electron-vite5/vite 配对写死 | electron-vite 配置、main/preload 骨架 |
| T2c | renderer 导航壳与占位页 | T2b | 内联 ui-prototype §2.1/2.3 | App 壳、导航栏、占位页 |
| T3 | RPC 分帧器 | T1 | 内联 pi-protocol §1 | jsonl-framing.ts + L1 红线 |
| T4 | RPC 客户端(不拆) | T3 | 内联 §2/§6/§7 | rpc-client.ts + 单测 |
| T5a | 隔离 env 装配 | T1 | — | env.ts、shared/paths.ts + 单测 |
| T5b | 版本预检 | T5a | pi --version 输出实查 | version.ts + 单测 |
| T6 | 进程状态机(不拆) | T4+T5b | 内联 §8/§5 | pi-process.ts + 单测 |
| T7a | 进程池(mock) | T6 | — | pi-pool.ts + 单测 |
| T7b | L2 真机集成 | T7a | 手验 pi rpc 握手一遍 | rpc-session.l2.test.ts |
| T8a | IPC 注册 + manager | T7a | — | pi-host-manager、main/ipc.ts |
| T8b | preload 白名单桥 | T8a | — | preload 填充 |
| T9a | 消息渲染三件 | T2a | 内联 §5.1/§2.3 | message-item/thinking-block/tool-row |
| T9b | 消息流 + rAF flush | T9a | — | message-list.tsx |
| T9c | Composer | T2a | 内联 §5.1 | composer.tsx |
| T10a | session-store | T8b | — | reducer + 单测 |
| T10b | 会话视图与接线 | T9a/b/c+T10a | 内联 §5.1 | session-view/tabs、renderer 接线 |
| T10c | 审批条与异常态 | T10b | 内联 §5.1/§2 | approval-bar、toast |
| T11a | settings-store(main) | T8a | — | models/auth.json 原子写 + 两通道实装 |
| T11b | SettingsDialog | T11a+T10b | 内联 §6/§5.1 | settings-dialog.tsx |
| T11c | ModelMenu | T10b | 内联 §6/§5.1 | model-menu.tsx |
| T12a | 隔离验收脚本 | T7b | — | scripts/isolation-check.sh |
| T12b | 升级冒烟 + 清单骨架 | T7b | — | regression-pi.sh、手动清单骨架 |
| T13a | pi 分发与 builder 配置 | T2b | pi release URL/sha256 实查 | fetch-pi.sh、electron-builder 段 |
| T13b | CI workflow | T13a | — | .github/workflows/ci.yml |

出口:全卡 merged → 主线程跑 L4 + m1-design §9 出口核验 → 产出 `docs/acceptance/m1-acceptance.md` → 环节二用户验收(Windows 真机)。

---

## T1 ✅ workspace 根 + shared(5e1e6bb)

已合入:根配置 8 文件;shared protocol/ipc/redact+6 测试;DEPENDENCIES.md。详见 git log。

## T2a ui 包底座与设计令牌

- **目标**:packages/ui 可构建,Tailwind4 + 设计令牌 CSS variables 立起。
- **前置(主线程)**:实查 tailwind 4.x 与 vite 配对、@vitejs/plugin-react 版本,写死进卡。
- **产出**:`packages/ui/package.json`、`tsconfig.json`、`vite.config.ts`(library 模式或空壳)、`src/styles/tokens.css`。
- **要点(内联源:ui-prototype §2.1/§2.2)**:九令牌原值(bg-0 #141517 / bg-1 #1b1d20 / bg-2 #222528 / text-0 #e4e6e8 / text-1 #9aa0a6 / hairline #2e3237 / focus #4c8dff / ok #3fb950 / err #f85149 / warn #d29922)落 CSS variables;正文 14px/行高1.5;mono 栈 Cascadia Code→JetBrains Mono。
- **验收**:`pnpm --filter @pidesk/ui typecheck 2>&1 | tail -20 && pnpm --filter @pidesk/ui build 2>&1 | tail -20`

## T2b desktop 三进程壳

- **目标**:Electron 三进程骨架可构建,安全清单逐项落地。
- **前置(主线程)**:实查 electron-vite 5 与 vite 版本配对(不兼容→降 Vite 7 决策),写死版本;electron 44.3.0。
- **产出**:`apps/desktop/package.json`、`electron.vite.config.ts`、`src/main/index.ts`、`src/preload/index.ts`(contextBridge 暴露空命名空间 `window.pidesk`,不透传 ipcRenderer)、`src/renderer/index.html` 最小挂载点。
- **要点(内联源:m1-design §7)**:contextIsolation:true、nodeIntegration:false、sandbox:true、CSP `default-src 'self'`、禁 remote、devtools 仅开发态。
- **验收**:`pnpm --filter @pidesk/desktop build 2>&1 | tail -20 && pnpm -r typecheck 2>&1 | tail -10`

## T2c renderer 导航壳与占位页

- **目标**:应用壳布局(导航栏 + 主区)+ 占位页。
- **前置(主线程)**:内联 ui-prototype §2.3(布局线框)与 §2.1 令牌表。
- **产出**:`packages/ui/src/app-shell.tsx`(或 desktop renderer 内,按依赖方向定)、`pages/placeholder.tsx`;desktop renderer 接入。
- **要点**:左 220px 导航栏(会话/工作流/运行/配置,图标+文字 30px 行高,lucide 16px)+ 主区;工作流/运行/配置占位禁用态;仅令牌用色,hairline 分隔。
- **验收**:`pnpm --filter @pidesk/desktop build 2>&1 | tail -20`

## T3 RPC 分帧器

- **目标**:严格 JSONL 分帧(pi-host 第一块红线件)。
- **前置(主线程)**:内联 pi-protocol §1 全表。
- **产出**:`packages/pi-host/` 包骨架 + `src/jsonl-framing.ts` + `jsonl-framing.test.ts`。
- **要点**:仅 `\n` 切分、剥行尾 `\r`、StringDecoder 跨 chunk UTF-8、流结束残缺 buffer 作尾行、**禁用 readline**(U+2028/2029 会切坏帧);缓冲 + indexOf 循环。单测必含:跨 chunk 多字节、CRLF、U+2028、无尾换行、半行续帧、空行。
- **验收**:`pnpm --filter @pidesk/pi-host test:coverage 2>&1 | tail -25`(分帧器行覆盖 ≥80% 红线)

## T4 RPC 客户端(不拆:强内聚)

- **目标**:命令发送/响应关联/事件分派/超时/错误分级。
- **前置(主线程)**:内联 pi-protocol §2 封套表、§6、§7;decisions DR-002。
- **产出**:`src/rpc-client.ts` + `rpc-client.test.ts`。
- **要点**:id=`req_<自增>` PendingRequest;事件乱序容忍;prompt 响应滞后(preflight 才回);超时分级 5s/30s/120s/bash 无超时(常量集中可配);四路分派 response/extension_ui_request/extension_error/事件;错误三级计数;L1 连续 5 行损坏→crashed。
- **单测**:内存双工 mock 流:关联/超时/success:false/parse 错误/事件先于响应/乱序。
- **验收**:`pnpm --filter @pidesk/pi-host test 2>&1 | tail -20`

## T5a 隔离 env 装配

- **目标**:隔离数据目录装配(纯函数)。
- **前置(主线程)**:内联 m1-design §4;product-plan F1/F6。
- **产出**:`packages/pi-host/src/env.ts` + 单测;`packages/shared/src/paths.ts`。
- **要点**:env 四项(PI_CODING_AGENT_DIR/SESSION_DIR、HTTP(S)_PROXY 预留空、PIDESK_HOST=1);dataDir 打包态 userData/开发态 `<仓库根>/.pidesk-dev`(PIDESK_DATA_DIR 覆盖);bootstrap 原子写(tmp+rename)`{"defaultProjectTrust":"never"}`,已存在不覆盖。
- **验收**:`pnpm --filter @pidesk/pi-host test 2>&1 | tail -20 && pnpm -r typecheck 2>&1 | tail -10`

## T5b 版本预检

- **目标**:pi 二进制解析与版本比对。
- **前置(主线程)**:实查 `/usr/local/bin/pi --version` 输出格式,贴进卡。
- **产出**:`src/version.ts` + 单测。
- **要点**:解析序 `PIDESK_PI_PATH` > PATH `pi` > 报错指引;独立短进程 `--version` 比对 pi-manifest.json;不符→告警不阻断(开发模式)。
- **验收**:`pnpm --filter @pidesk/pi-host test 2>&1 | tail -20`

## T6 进程状态机(不拆:强内聚)

- **目标**:单 pi 进程生命周期管理(消费 T5 env/version 与 T4 rpc-client)。
- **前置(主线程)**:内联 pi-protocol §8 全节、§5 退出语义。
- **产出**:`src/pi-process.ts` + `pi-process.test.ts`。
- **要点**:状态 spawning→handshaking→ready⇄busy→stopping→crashed/stopped;握手=首个 get_state 成功;busy 由 agent_settled 回 ready;事件缓冲未 ready 入队握手后重放;退出兜底(DR-002)stdin.end()→3s→SIGTERM→2s→树杀。
- **单测**:mock 子进程全状态迁移(≥80% 红线对象)。
- **验收**:`pnpm --filter @pidesk/pi-host test:coverage 2>&1 | tail -25`

## T7a 进程池(mock)

- **目标**:多会话池纯逻辑。
- **前置(主线程)**:内联 m1-design §3 pi-pool 行。
- **产出**:`src/pi-pool.ts` + `pi-pool.test.ts`(mock PiProcess)。
- **要点**:每会话一进程;并发上限 4;空闲回收 30min;崩溃退避 1s/2s/4s×3 + switch_session 恢复;耗尽报错不自动拉起。
- **验收**:`pnpm --filter @pidesk/pi-host test 2>&1 | tail -20`

## T7b L2 真机集成

- **目标**:真实 pi 闭环测试。
- **前置(主线程)**:主线程手工跑通一次 `pi --mode rpc` 握手+prompt(输出已知),把实测行为写进卡。
- **产出**:`packages/pi-host/l2/rpc-session.l2.test.ts`。
- **要点**:spawn 真 pi(env 隔离至临时 PIDESK_DATA_DIR);断言 握手 get_state→prompt→text_delta≥1→agent_settled→get_messages 含回复;`describe.skipIf(!piPath)`;超时 ≤60s;不触 `~/.pi`。
- **验收**:`pnpm --filter @pidesk/pi-host test 2>&1 | tail -30`

## T8a IPC 注册 + manager

- **目标**:main 进程通道注册与 PiHostManager 装配。
- **前置(主线程)**:内联 m1-design §5 全表。
- **产出**:`apps/desktop/src/main/pi-host-manager.ts`、`src/main/ipc.ts`;shared/ipc.ts 类型对齐微调(不动契约)。
- **要点**:invoke 8 条转接 pi-pool;push 2 条按 sessionId 定向 send;extension_ui_request confirm/select/input 入队转发,notify 透传,其余忽略。
- **验收**:`pnpm -r typecheck 2>&1 | tail -10 && pnpm --filter @pidesk/desktop build 2>&1 | tail -15`

## T8b preload 白名单桥

- **目标**:renderer 可调用的契约面锁死。
- **前置(主线程)**:内联 m1-design §5 规则段。
- **产出**:`src/preload/index.ts` 填充;`shared/ipc.ts` 增益暴露类型(如需)。
- **要点**:contextBridge 仅暴露契约方法;getModelConfig 返回前过 shared redact;不透传 ipcRenderer。
- **验收**:`pnpm --filter @pidesk/desktop build 2>&1 | tail -15 && pnpm -r typecheck 2>&1 | tail -10`

## T9a 消息渲染三件

- **目标**:单条消息的三个渲染分支。
- **前置(主线程)**:内联 ui-prototype §2.3 对话流、§5.1、§2.1/§2.2 令牌;m1-design §6 MessageList 段。
- **产出**:`packages/ui/src/components/message-item.tsx`、`thinking-block.tsx`、`tool-row.tsx` + 组件测试。
- **要点**:thinking→折叠摘要行(text-1 12px);toolcall_end+tool_execution_*→折叠行三态(呼吸点/✓+耗时/err+stderr 展开);usage 累计→token 计数(mono 12px);仅令牌用色。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20`

## T9b 消息流 + rAF flush

- **目标**:流式消息列表。
- **前置(主线程)**:内联 m1-design §6;ui-prototype §2.3。
- **产出**:`src/components/message-list.tsx` + 测试。
- **要点**:单列 ≤72ch;text_delta rAF 批量 flush(16ms 窗口)驱动 react-markdown 增量;hairline 分隔。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20 && pnpm --filter @pidesk/ui build 2>&1 | tail -10`

## T9c Composer

- **目标**:输入区。
- **前置(主线程)**:内联 ui-prototype §5.1 输入区段。
- **产出**:`src/components/composer.tsx` + 测试。
- **要点**:Enter 发送/Shift+Enter 换行;发送中 ⏹ 中止;队列计数提示(steering/followUp);审批条预留挂点(T10c)。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20`

## T10a session-store

- **目标**:renderer 状态机纯逻辑。
- **前置(主线程)**:内联 m1-design §5/§6 状态段。
- **产出**:`packages/ui/src/state/session-store.ts`(context+reducer,不引状态库)+ 单测。
- **要点**:订阅 event/process 按 sessionId 分发;会话生命周期(新建/切换/关闭=回收);agent_settled→复位;crashed 分支占位(T10c)。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20`

## T10b 会话视图与接线

- **目标**:端到端可对话(不含审批/toast)。
- **前置(主线程)**:内联 ui-prototype §5.1 空态。
- **产出**:`src/components/session-view.tsx`、`session-tabs.tsx`;desktop renderer 替换占位页。
- **要点**:空态=居中引导文案(不放假插画);标签新建/切换/关闭;接 T9 组件与 T10a store。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20 && pnpm --filter @pidesk/desktop build 2>&1 | tail -15`

## T10c 审批条与异常态

- **目标**:extension_ui_request 人机交互与错误呈现。
- **前置(主线程)**:内联 ui-prototype §5.1 审批条;pi-protocol §2。
- **产出**:`src/components/approval-bar.tsx`、`toast.tsx`;store 扩展 confirm/notify/crashed 分支。
- **要点**:confirm 固着输入框上方(批准/拒绝+风险摘要),不弹窗;notify→toast 3s 自散;crashed→错误态+重试。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20 && pnpm --filter @pidesk/desktop build 2>&1 | tail -15`

## T11a settings-store(main)

- **目标**:单连接配置落盘(2026-09-10 裁决:仅单连接)。
- **前置(主线程)**:内联 m1-design §6 SettingsDialog/§4 bootstrap。
- **产出**:`apps/desktop/src/main/settings-store.ts`;T8a 两 settings 通道实装。
- **要点**:原子写 models.json(+auth.json 若 saveKey);getModelConfig 返回前 redact;字段 preset("ollama"|"custom-openai")/baseUrl/apiKey?/modelId/saveKey;Ollama 预置 `http://localhost:11434/v1`。
- **验收**:`pnpm -r typecheck 2>&1 | tail -10 && pnpm --filter @pidesk/desktop build 2>&1 | tail -15`

## T11b SettingsDialog

- **目标**:单连接表单 UI。
- **前置(主线程)**:内联 m1-design §6;ui-prototype §5.2 凭据行。
- **产出**:`packages/ui/src/components/settings-dialog.tsx` + 测试。
- **要点**:二选一预置(Ollama/自定义);apiKey password 型、回显仅 `…last4`;「保存凭据」或「仅本会话环境变量」二选一;保存→提示重启会话生效。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20`

## T11c ModelMenu

- **目标**:模型/思考切换菜单。
- **前置(主线程)**:内联 m1-design §6 ModelMenu;ui-prototype §5.1。
- **产出**:`src/components/model-menu.tsx` + 测试。
- **要点**:左下角 `provider/model:thinking`;数据 listModels+get_available_thinking_levels;set_model/set_thinking_level;等宽仅模型 id。
- **验收**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20 && pnpm --filter @pidesk/desktop build 2>&1 | tail -15`

## T12a 隔离验收脚本

- **目标**:双向隔离 A1~A4 脚本化。
- **前置(主线程)**:内联 m1-design §8;dev-process §4 L4。
- **产出**:`scripts/isolation-check.sh`(可执行,set -euo pipefail)。
- **要点**:临时 PIDESK_DATA_DIR 走 L2 路径完成一轮对话;断言 ~/.pi/sessions 无新会话、~/.pi mtime 不变、隔离区出现本轮 JSONL;全局 skill 项无注入环境记 SKIP 并标注手动补验;只读 ~/.pi;输出人话判定。
- **验收**:`bash scripts/isolation-check.sh 2>&1 | tail -20`

## T12b 升级冒烟 + 清单骨架

- **目标**:pi 升级四项冒烟 + 手动清单。
- **前置(主线程)**:内联 dev-process §4 L4 四项定义。
- **产出**:`scripts/regression-pi.sh`;`docs/acceptance/m1-manual-checklist.md` 骨架(供验收包引用)。
- **要点**:四项=RPC 握手/prompt 事件流/会话持久/abort 生效;参数化 pi 路径。
- **验收**:`bash scripts/regression-pi.sh 2>&1 | tail -20 && bash -n scripts/regression-pi.sh`

## T13a pi 分发与 builder 配置

- **目标**:打包期 pi binary 注入链路。
- **前置(主线程)**:实查 pi v0.85.1 release 下载 URL 与 sha256,写死。
- **产出**:`scripts/fetch-pi.sh`;desktop package.json electron-builder 段(extraResources)。
- **要点**:下载固定 tag standalone + sha256 校验(不符拒绝)+ 生成 `resources/pi/pi-manifest.json`(版本/sha256/来源)。
- **验收**:`bash -n scripts/fetch-pi.sh && pnpm --filter @pidesk/desktop build 2>&1 | tail -15`(本地不出 Windows 包,产物验证在 CI)

## T13b CI workflow

- **目标**:push 即 CI;Windows NSIS 产物(P3)。
- **前置(主线程)**:内联 dev-process §6;product-plan §10。
- **产出**:`.github/workflows/ci.yml`。
- **要点**:install→lint→typecheck→L1+L2→build;windows-latest 出 NSIS(内含 fetch-pi 步);linux 仅 build;macOS 不做。
- **验收**:`pnpm -r build 2>&1 | tail -10 && pnpm -r test 2>&1 | tail -10`(CI 绿由主线程 push 后核)

---

## 附:派发与验收备注

1. **-t 组装**:总表「前置(主线程)」完成后,将本卡全文 + 内联源原文贴入描述(~1-3k 字)。
2. **返工**:`dispatch.sh -c` 续接,附文件+行级问题清单;>3 轮熔断。
3. **UI 卡红线**:T2a/T2c/T9/T10/T11 任何样式偏离 ui-prototype 令牌系统即打回。
4. **每卡 merged 后**:主线程在总表标记 ✅ + hash,并更新 handoff.md 卡进度。

| 修订记录 | 日期 | 内容 |
|----------|------|------|
| v1.0 | 2026-09-10 | 初版 13 卡 |
| v1.1 | 2026-09-10 | 外部评审四条吸收;预消化纪律;T1 重写预消化模式 |
| v2.0 | 2026-09-10 | 用户指示:剩余全部 16k、最小粒度拆分——14→26 卡,消除全部 32k 卡;每卡增「前置(主线程)」段 |

# M1 任务卡(m1-tasks v1.0)

> 2026-09-10。E 阶段产物之三,前置:pi-protocol v1.0、m1-design v1.0(均过环节一,§10 裁决:单连接;dev 数据目录 `<仓库根>/.pidesk-dev`)。
> 用途:主线程派发手册。每卡按 16k 上下文预算拆分,派发时将「内联要点」所引章节文本直接贴进 `-t` 描述;`-v` 验收命令原样传入 dispatch.sh。
> 纪律:同一工作目录**串行派发**(按序号);子线程禁 git、禁新增依赖;每卡 DoR/DoD 与生命周期见 dev-process §3;依赖白名单 = m1-design §1 版本表,超表即违规。
> **预消化纪律(v1.1)**:install、版本实查、环境修复等大输出/确定性操作由主线程派发前完成;子线程卡仅含"写码 + 单次验收",验收命令一律 `2>&1 | tail -20` 截断;静态+动态目标 ≤10k token,16k 内余量 ≥6k(依据:T1 四连败根因复盘,retro 待录)。
> **外部评审吸收(v1.1)**:T10 拆 T10a/T10b(熔断半径减半);T5/T6 对调(env 装配是状态机的前置消费件,原依赖方向写反);T12 附带手动清单骨架;T9 五文件强内聚注记保留。

---

## 0. 派发序列总表

| 卡 | 名称 | 依赖 | 模型 | 核心产出 |
|----|------|------|------|----------|
| T1 | workspace 根 + shared 类型字典(预消化) | — | 16k | 主线程预消化 install;子线程仅写 shared 4 源文件 |
| T2 | ui 底座 + desktop Electron 壳 | T1 | 32k | Tailwind4 令牌底座;electron-vite 三进程壳 + 安全清单 |
| T3 | RPC 分帧器 | T1 | 16k | pi-host `jsonl-framing.ts` + L1(覆盖率红线) |
| T4 | RPC 客户端 | T3 | 32k | pi-host `rpc-client.ts`(关联/超时/分派)+ 单测 |
| T5 | 隔离 env 装配与版本预检 | T1 | 16k | pi-host `env.ts`、`version.ts`、shared `paths.ts` + 单测 |
| T6 | 进程状态机 | T4+T5 | 16k | pi-host `pi-process.ts` + 单测 |
| T7 | 进程池 + L2 真机集成 | T6 | 32k | pi-host `pi-pool.ts` + L2 vitest(spawn 真 pi) |
| T8 | IPC 装配与 preload 桥 | T7 | 16k | main 进程通道注册;preload 白名单桥 |
| T9 | 对话流组件 | T8 | 32k | ui MessageList 组、Composer(五文件强内聚) |
| T10a | 会话面板状态接线 | T9 | 16k | session-store、SessionTabs、renderer 接线(可对话) |
| T10b | 审批条与异常态 | T10a | 16k | approval-bar、toast、收态/错误态 |
| T11 | 模型菜单与单连接设置 | T10b | 16k | ModelMenu、SettingsDialog → models/auth.json |
| T12 | L4 专项脚本 | T11 | 16k | isolation/regression 脚本 + 手动清单骨架 |
| T13 | CI 与 Windows 产物接线 | T12 | 16k | fetch-pi 脚本、electron-builder、GitHub Actions |

出口:T1~T13(含 T10a/b)全 merged → 主线程跑 L4 + 出口标准核验(m1-design §9)→ 产出 `docs/acceptance/m1-acceptance.md` 验收包 → 提请环节二用户验收(Windows 真机)。

---

## T1 workspace 根 + shared 类型字典(预消化模式)

> 前史:v1.0 四次派发未过(16k 临界 × pi 0.85.1 compaction bug),按预消化纪律重做;根配置 8 文件与 shared 2 源文件已由第 4 次会话落盘,主线程核验后复用。

- **目标**:monorepo 骨架可 install/build/test;`@pidesk/shared` 提供协议类型字典(DR-001)、IPC 契约、日志脱敏。
- **主线程预消化(不派发)**:核验/补齐根配置与 shared 的 package.json+tsconfig(版本实查后写死);跑 `pnpm install`;登记 DEPENDENCIES.md。
- **产出**:`pnpm-workspace.yaml`、根 `package.json`、`tsconfig.base.json`、`.editorconfig`、`.gitignore`(含 `.pidesk-dev/`、`node_modules`、dist)、根 ESLint flat config(含 import 边界规则:desktop→ui→pi-host→shared 单向)、根 vitest 配置;`packages/shared/`(`package.json`、`tsconfig.json`、`src/protocol.ts`、`src/ipc.ts`、`src/redact.ts`、`src/redact.test.ts`);`docs/DEPENDENCIES.md` 按版本表登记(dev/runtime 分列)。
- **要点(内联源:m1-design §1 版本表、§2 结构、§5 IPC 表)**:
  - `protocol.ts`:仅 `export type { ... } from "@earendil-works/pi-coding-agent"`(devDependency **0.85.1** 精确锁版,`import type` 零运行时,DR-001);导出 `JsonAgentSessionEvent`/`RpcSessionState`/`ExtensionUIRequest`/`ExtensionError` 等 UI 与宿主所需类型。
  - `ipc.ts`:invoke 8 条 + push 2 条通道名常量(`pidesk:` 前缀)与全部载荷 TS 类型(m1-design §5 表逐行),三方共用。
  - `redact.ts`:正则脱敏 `apiKey/authorization/sk-…/token` 类键值 → `***`;单测覆盖键值对、URL query、嵌套 JSON 字符串。
- **约束**:workspace 包名 `@pidesk/*`(T9);ESM(Node24,`.js` 扩展名导入);脚本统一 `typecheck`=`tsc --noEmit`。
- **验收命令**:`pnpm --filter @pidesk/shared typecheck 2>&1 | tail -20 && pnpm --filter @pidesk/shared test 2>&1 | tail -20`

## T2 ui 底座 + desktop Electron 壳

- **目标**:可启动的 Electron 三进程骨架 + React 渲染壳(导航栏布局 + 占位页),Tailwind4 令牌系统立起。
- **产出**:`packages/ui/`(package.json、tailwind4 配置、`src/styles/tokens.css` 令牌 → CSS variables、空组件目录);`apps/desktop/`(electron-vite 5 配置、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/`:App 壳 + 会话/配置占位页 + `index.html`);根 `pnpm-workspace.yaml` 增 apps 项(如需)。
- **要点(内联源:m1-design §2/§7;ui-prototype §2.1/§2.2/§2.3)**:
  - tokens.css:§2.1 九个令牌原值落 CSS variables;正文 14px/1.5、代码 Cascadia Code→JetBrains Mono;窗口最小 960×640。
  - 布局:左 220px 导航栏(会话/工作流/运行/配置,图标+文字 30px 行高,lucide 16px)+ 主区;工作流/运行/配置 M1 占位禁用态。
  - 安全清单(m1-design §7)逐项落 main 配置:contextIsolation、nodeIntegration:false、sandbox、`default-src 'self'` CSP、禁 remote、devtools 仅开发态。
  - preload 本卡仅 contextBridge 暴露空命名空间 `window.pidesk`(T8 填充),**不透传 ipcRenderer**。
- **约束**:electron-vite 5 + Vite 8 配对(兼容问题→降 Vite 7 兜底,m1-design §1);React 19.3。
- **验收命令**:`pnpm -r typecheck && pnpm --filter @pidesk/ui build && pnpm --filter @pidesk/desktop build`

## T3 RPC 分帧器

- **目标**:严格 JSONL 分帧,pi-host 第一块红线件。
- **产出**:`packages/pi-host/src/jsonl-framing.ts` + `jsonl-framing.test.ts`(+包骨架:package.json/tsconfig)。
- **要点(内联源:pi-protocol §1 全表)**:仅按 `\n` 切分、剥行尾 `\r`(容忍 CRLF)、StringDecoder 处理跨 chunk UTF-8 多字节、流结束残缺 buffer 作尾行、**禁用 readline**(U+2028/U+2029 在 JSON 字符串内合法会切坏帧);缓冲 + `indexOf("\n")` 循环。
- **单测必含**:跨 chunk 切断多字节字符、CRLF、含 U+2028 的字符串、无尾换行、半行→续帧、空行容忍。
- **验收命令**:`pnpm --filter @pidesk/pi-host test:coverage`(分帧器行覆盖 ≥80%,红线)

## T4 RPC 客户端

- **目标**:命令发送/响应关联/事件分派/超时/错误分级。
- **产出**:`packages/pi-host/src/rpc-client.ts` + `rpc-client.test.ts`。
- **要点(内联源:pi-protocol §2 封套表、§6、§7;decisions DR-002)**:
  - id=`req_<自增>` PendingRequest 表;事件乱序容忍(id 关联唯一正确方式,禁"下一 response 前事件归该命令"假设);`prompt` 响应滞后(preflight 才回,可能晚于首批事件)。
  - 超时(DR-002):即时类 5s / prompt 30s / compact 120s / bash·export_html 无超时;常量集中定义可配。
  - 四路分派:`response`/`extension_ui_request`/`extension_error`/会话事件;错误三级(传输/协议/业务)计数与回调;L1 连续 5 行损坏→协议破裂→crashed。
- **单测**:内存双工 mock 流覆盖 关联成功/超时/success:false/parse 错误/事件先于响应/乱序。
- **验收命令**:`pnpm --filter @pidesk/pi-host test`

## T5 隔离 env 装配与版本预检

- **目标**:隔离数据目录装配 + pi 二进制来源解析(纯函数,状态机与进程池的前置消费件)。
- **产出**:`packages/pi-host/src/env.ts`、`version.ts` + 各自单测;`packages/shared/src/paths.ts`(dataDir 解析,desktop 与 pi-host 共用)。
- **要点(内联源:m1-design §4 全节;product-plan F1/F6)**:
  - env:`PI_CODING_AGENT_DIR=<dataDir>/pi-agent`、`PI_CODING_AGENT_SESSION_DIR=<dataDir>/pi-agent/sessions`、`HTTP_PROXY/HTTPS_PROXY` 预留空值、`PIDESK_HOST=1`。
  - dataDir:打包态 `app.getPath('userData')`;开发态默认 `<仓库根>/.pidesk-dev`(2026-09-10 裁决),`PIDESK_DATA_DIR` 覆盖;bootstrap 原子写(tmp+rename)`settings.json` = `{"defaultProjectTrust":"never"}`(F6),已存在不覆盖。
  - version.ts:spawn 前独立短进程 `<pi> --version` 比对 pi-manifest.json;不符→告警不阻断(开发模式);二进制解析序 `PIDESK_PI_PATH` > PATH `pi` > 报错指引。
- **验收命令**:`pnpm --filter @pidesk/pi-host test 2>&1 | tail -20 && pnpm -r typecheck 2>&1 | tail -20`

## T6 进程状态机

- **目标**:单 pi 进程生命周期管理(消费 T5 env/version 与 T4 rpc-client)。
- **产出**:`packages/pi-host/src/pi-process.ts` + `pi-process.test.ts`。
- **要点(内联源:pi-protocol §8 状态机图+崩溃重启+孤儿防护、§5 退出语义)**:
  - 状态:spawning→handshaking→ready⇄busy→stopping→crashed/stopped;握手=首个 `get_state` 成功(响应快照直接灌 UI);busy 判定=`agent_settled` 回 ready;abort 后经 stopping。
  - 事件缓冲:未 ready 前收到的事件入队,握手后重放。
  - 退出兜底(DR-002):`stdin.end()` → 3s → SIGTERM → 2s → `taskkill /T`(win)/SIGKILL 树杀。
- **单测**:mock 子进程事件驱动全状态迁移覆盖(状态机与分帧器同为 ≥80% 红线对象)。
- **验收命令**:`pnpm --filter @pidesk/pi-host test:coverage`

## T7 进程池 + L2 真机集成

- **目标**:多会话进程池与真实 pi 闭环。
- **产出**:`packages/pi-host/src/pi-pool.ts` + `pi-pool.test.ts`(mock)+ `l2/rpc-session.l2.test.ts`(真 pi)。
- **要点(内联源:m1-design §3 pi-pool 行;pi-protocol §9 M1 子集)**:
  - 池:每会话一 PiProcess;并发上限 4;空闲回收 30min;崩溃重启退避 1s/2s/4s×3,成功后 `switch_session` 恢复原 sessionFile;3 次耗尽报错不再自动拉起。
  - L2:spawn 真 pi(`/usr/local/bin/pi`,0.85.1)`--mode rpc`,env 隔离至临时目录;断言 握手 get_state 成功→prompt→收到 text_delta≥1→agent_settled→get_messages 含回复;测试独立 `PIDESK_DATA_DIR`,不触 `~/.pi`。
- **约束**:L2 用例打 `describe.skipIf(!piPath)` 防环境缺失红;测试超时 ≤60s。
- **验收命令**:`pnpm --filter @pidesk/pi-host test 2>&1 | tail -30`(L1+L2 全绿)

## T8 IPC 装配与 preload 桥

- **目标**:main⇄renderer 契约接线,IPC 面锁死。
- **产出**:`apps/desktop/src/main/ipc.ts`(通道注册 + PiHostManager 装配)、`src/main/pi-host-manager.ts`、`src/preload/index.ts` 填充;`packages/shared/src/ipc.ts` 类型对齐微调(如需,不动契约)。
- **要点(内联源:m1-design §5 全表;pi-protocol §2)**:
  - invoke 8 条逐条转接 pi-pool;push 2 条(`pidesk:event`/`pidesk:process`)按 sessionId 定向 webContents.send。
  - `extension_ui_request`:`confirm/select/input` 入队转发渲染层;`notify/setStatus/setWidget/setTitle` M1 仅 notify 透传(T10 toast),其余忽略。
  - preload:contextBridge 仅暴露契约方法;`settings:getModelConfig` 返回前过 shared `redact`。
- **验收命令**:`pnpm -r typecheck && pnpm --filter @pidesk/desktop build`

## T9 对话流组件

- **目标**:会话面板核心两件:消息流 + 输入区(五文件强内聚:同一 `message_update` 渲染链的四分支 + 输入区,不拆分;外部评审②辩护项)。
- **产出**:`packages/ui/src/components/message-list.tsx`、`message-item.tsx`、`tool-row.tsx`、`thinking-block.tsx`、`composer.tsx` + 组件单测(事件序列→渲染快照/状态断言)。
- **要点(内联源:m1-design §6 MessageList/Composer;ui-prototype §2.3 对话流、§5.1、§2.1/§2.2 令牌)**:
  - 单列 ≤72ch;`text_delta` rAF 批量 flush(16ms)驱动 react-markdown 增量;`thinking_delta`→折叠摘要行(text-1 12px);`toolcall_end`+`tool_execution_*`→折叠行三态(呼吸点/✓+耗时/err+stderr 展开);`message_update.usage` 累计→条目侧 token 计数(mono 12px)。
  - Composer:Enter 发送/Shift+Enter 换行;发送中 ⏹ 中止;队列计数提示(steering/followUp)。
  - 纪律:仅令牌系统用色;hairline 分隔;无阴影无装饰动效;键盘可达。
- **验收命令**:`pnpm --filter @pidesk/ui test && pnpm --filter @pidesk/ui build`

## T10a 会话面板状态接线

- **目标**:renderer 状态机接 IPC,可建会话/切换/对话(不含审批/toast)。
- **产出**:`packages/ui/src/state/session-store.ts`(context+reducer,不引状态库)、`session-view.tsx`、`session-tabs.tsx`;desktop renderer 接线替换占位页。
- **要点(内联源:m1-design §5/§6;ui-prototype §5.1)**:
  - 订阅 `pidesk:event`/`pidesk:process` 按 sessionId 分发 reducer;空态 = 居中引导文案(§5.1,不放假插画);会话标签新建/切换/关闭(关=进程回收);`agent_settled`→Composer 复位。
- **验收命令**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20 && pnpm --filter @pidesk/desktop build 2>&1 | tail -20 && pnpm -r typecheck 2>&1 | tail -10`

## T10b 审批条与异常态

- **目标**:extension_ui_request 人机交互与错误呈现。
- **产出**:`packages/ui/src/approval-bar.tsx`、`toast.tsx`;T10a store 扩展 confirm/notify/crashed 分支。
- **要点(内联源:ui-prototype §5.1 审批条;pi-protocol §2)**:
  - 审批条:`extension_ui_request confirm` 固着输入框上方(批准/拒绝+风险摘要),不弹窗;notify→toast 3s 自散。
  - 异常态:crashed→面板错误态 + 重试按钮。
- **验收命令**:`pnpm --filter @pidesk/ui test 2>&1 | tail -20 && pnpm --filter @pidesk/desktop build 2>&1 | tail -20`

## T11 模型菜单与单连接设置

- **目标**:模型切换 + 单连接配置闭环(2026-09-10 裁决:仅单连接)。
- **产出**:`packages/ui/src/components/model-menu.tsx`、`settings-dialog.tsx`;`apps/desktop/src/main/settings-store.ts`(models.json/auth.json 读写)。
- **要点(内联源:m1-design §6 ModelMenu/SettingsDialog、§4 bootstrap;product-plan T7/F8)**:
  - ModelMenu:左下角 `provider/model:thinking`;数据 `listModels`+`get_available_thinking_levels`;切换走 `set_model`/`set_thinking_level`。
  - SettingsDialog:单连接表单,预置 Ollama(`http://localhost:11434/v1`)与自定义 OpenAI 兼容二选一;字段 baseUrl/apiKey(可选)/modelId;「保存凭据」可选(存 auth.json)或「仅本会话环境变量」;保存→原子写 models.json(+auth.json)→提示重启会话生效。
  - apiKey 输入 password 型;界面回显仅 `…last4`;日志零落 key(过 redact)。
- **验收命令**:`pnpm --filter @pidesk/ui test && pnpm -r typecheck && pnpm --filter @pidesk/desktop build`

## T12 L4 专项脚本

- **目标**:双向隔离验收与 pi 升级冒烟脚本化。
- **产出**:`scripts/isolation-check.sh`、`scripts/regression-pi.sh`(可执行,`set -euo pipefail`);附带产出 `docs/acceptance/m1-manual-checklist.md` 骨架(L3 手动清单,dev-process §4),供验收包直接引用、避免临时赶工(外部评审④)。
- **要点(内联源:m1-design §8 A1~A4;dev-process §4 L4)**:
  - isolation-check:以临时 `PIDESK_DATA_DIR` 走 pi-host L2 路径完成一轮对话,断言 ①`~/.pi/sessions` 无新会话 ②`~/.pi` mtime 快照不变 ③隔离 sessions/ 出现本轮 JSONL;③(全局 skill 不渗透)以 `get_commands` 输出断言,无全局 skill 注入则记 SKIP 并在输出标注"手动补验"。
  - regression-pi:四项冒烟 = RPC 握手/prompt 事件流(text_delta+agent_end)/会话持久(JSONL 落盘+get_messages)/abort 生效;参数化 pi 路径,默认 PATH。
- **约束**:脚本只读 `~/.pi`,绝不写入;输出人话判定(每项 PASS/FAIL/SKIP + 原因)。
- **验收命令**:`bash scripts/isolation-check.sh && bash scripts/regression-pi.sh`(全 PASS 或标注 SKIP)

## T13 CI 与 Windows 产物接线

- **目标**:push 即 CI;Windows NSIS 产物可出(M1 出口 P3)。
- **产出**:`scripts/fetch-pi.sh`(下载 pi v0.85.1 standalone + sha256 校验 + 生成 `resources/pi/pi-manifest.json`)、electron-builder 配置(desktop package.json build 段 + `extraResources` 注入 pi binary,Windows 入口)、`.github/workflows/ci.yml`。
- **要点(内联源:product-plan §9/§10、dev-process §6;m1-design §1 electron-builder 26.15.3)**:
  - CI:push 触发 install→lint→typecheck→L1+L2→build;job 矩阵 windows-latest 出 NSIS(内含 fetch-pi 步);linux 仅 build 不出包(WSL 本地覆盖);macOS 不做(P3)。
  - pi 来源:GitHub release 固定 tag,清单记版本/sha256/来源 URL;sha256 不符拒绝打包。
  - 本卡不要求本地出 Windows 包(交叉打包不做);本地验收以配置与脚本语法为准,产物验证在 CI 由主线程核。
- **验收命令**:`pnpm -r build && pnpm -r test && bash -n scripts/fetch-pi.sh`(主线程 push 后另核 CI 绿)

---

## 附:派发与验收备注

1. **-t 组装**:每卡派发时,主线程将「要点(内联源)」所指章节**原文** + 本卡全文贴入描述;单卡描述控制在 ~3k 字内,超出说明内联源该精简。
2. **返工**:`dispatch.sh -c` 续接会话,附文件+行级问题清单与原始报错;同卡 >3 轮熔断升级用户(dev-process §8 环节三)。
3. **UI 卡红线**:T2/T9/T10/T11 任何样式偏离 ui-prototype 令牌系统即打回,不进验收。
4. **每卡 merged 后**:主线程在本文档对应卡标记 ✅ + commit hash(一卡一 commit,合卡不跳号)。
5. 本文档修订:任务卡增删/验收命令变更须记录于下表。

| 修订记录 | 日期 | 内容 |
|----------|------|------|
| v1.0 | 2026-09-10 | 初版 13 卡 |
| v1.1 | 2026-09-10 | 外部评审四条全采纳:T10 拆 T10a/b;T5/T6 对调修正依赖方向(env 是状态机前置消费件);T12 附手动清单骨架;T9 强内聚注记。增预消化纪律(install/版本实查/环境修复由主线程派发前完成;验收命令 tail 截断)。T1 重写为预消化模式 |

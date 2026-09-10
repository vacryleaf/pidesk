# M1 工程详设(m1-design v1.0)

> 2026-09-10。E 阶段产物之二,前置:pi-protocol.md v1.0(已过环节一,DR-001/002)。
> 范围 = product-plan §11 M1「隔离底座」:monorepo 脚手架;pi-host(RPC/生命周期/隔离 env);聊天面板 MVP;隔离目录最小 settings。出口标准见 §9。

---

## 0. 一页速览(环节一审阅入口)

1. **工具链已定版**(§2,当日实查 npm):Electron 44.3.0 + electron-vite 5 + Vite 8 + React 19.3 + TS **5.9.3**(TS7 观望)+ Tailwind 4 + vitest 5;pi 类型包 `@earendil-works/pi-coding-agent@0.85.1` 已确认在 npm(=上游 400d6905,DR-001 可落地)。
2. **M1 仅 4 个包**:desktop(main/preload/renderer 壳)+ shared(协议类型重导出/IPC 契约/脱敏)+ pi-host(RPC 客户端/进程池/隔离装配)+ ui(聊天面板);config-center/flow-engine 只留目录规划不建。
3. **IPC 契约一次定死**(§5):invoke 通道 8 条 + push 通道 2 条,全部 `pidesk:` 前缀、shared 类型载荷、preload 白名单暴露。
4. **provider 最小配置划界**(§6):M1 设置页 = 单连接表单(Ollama 预置 + 自定义 baseUrl/key)→ 写隔离目录 models.json/auth.json;多 provider 管理是 M2。
5. **隔离验收三用例可执行化**(§8),M1 出口连同 Windows 实测清单进验收包。
6. **待裁决 2 项**:§10(M1 是否支持多连接配置;dev 数据目录默认值)。

---

## 1. 工具链定版(2026-09-10 实查 registry.npmjs.org)

| 包 | 版本 | 用途 | 备注 |
|----|------|------|------|
| electron | 44.3.0 | 桌面壳 | |
| electron-vite / vite | 5.0.0 / 8.2.2 | 构建与 dev server | 官方配对;若兼容问题→降 Vite 7(任务卡自验兜底) |
| react / react-dom | 19.3.0 | UI | |
| typescript | **5.9.3** | 语言 | TS 7.0(Go 原生版)生态未跟,观望;升级须 DR |
| vitest | 5.0.0 | L1/L2 测试 | |
| tailwindcss | 4.3.3 | 令牌系统映射(shadcn/ui 底座) | CSS variables = ui-prototype §2.1 令牌 |
| react-markdown / remark-gfm | 10.1.0 / 4.0.1 | 对话流渲染 | |
| lucide-react | 1.43.0 | 图标(16px 线性) | |
| @earendil-works/pi-coding-agent | **0.85.1** | **devDependency,类型字典**(DR-001) | 与上游 400d6905 完全一致,已核实 |
| electron-builder | 26.15.3 | M1 末 Windows 产物(NSIS/portable) | |
| ❌ 不进 M1 | @playwright/test(M2)、@modelcontextprotocol/sdk(M2)、React Flow(M4)、zod(M2 表单) | | |

全部登记 DEPENDENCIES.md;registry 直连可达(0.8s),npmmirror 备选已验证(0.1s),CI 不强制镜像。

## 2. monorepo 结构(M1 裁剪版)

```
pidesk/
├── pnpm-workspace.yaml / package.json / tsconfig.base.json / .editorconfig
├── apps/desktop/
│   ├── src/main/          # 主进程:窗口管理 + PiHostManager 装配 + IPC 注册
│   ├── src/preload/       # contextIsolation 白名单桥(唯一 IPC 面)
│   └── src/renderer/      # React 壳:导航栏 + 路由占位(会话/配置占位页)
├── packages/shared/       # 协议类型重导出(DR-001)、IPC 通道契约、日志脱敏工具
├── packages/pi-host/      # 分帧器、RpcClient、PiProcess、进程池、隔离 env 装配
└── packages/ui/           # React 组件与面板(会话面板 MVP)
# docs 规划中的 config-center / flow-engine / extensions-src:M2/M3 再建,现在不占位
```

依赖方向:desktop → ui → pi-host → shared(单向,ESLint import 边界规则强制)。

## 3. pi-host 模块设计(协议依据:pi-protocol.md)

| 单元 | 职责 | 关键点 |
|------|------|--------|
| `jsonl-framing.ts` | 分帧器 | 按 pi-protocol §1 自研:`indexOf("\n")` 循环 + StringDecoder;L1 覆盖率红线对象 |
| `rpc-client.ts` | 请求关联 + 超时 | id=`req_N`;超时常量集中定义(DR-002);`response`/`extension_ui_request`/`extension_error`/事件四路分派 |
| `pi-process.ts` | 单进程生命周期 | 状态机(pi-protocol §8):spawning→handshaking→ready⇄busy→stopping→crashed/stopped;事件缓冲(未 ready 前收到的事件入队,握手后重放) |
| `pi-pool.ts` | 进程池 | 会话面板各占一进程;并发上限 4(P3 预留);空闲回收 30min;崩溃重启退避 1s/2s/4s×3,`switch_session` 恢复 |
| `env.ts` | 隔离 env 装配 | 见 §4 表 |
| `version.ts` | 版本预检 | spawn 前独立进程 `<pi> --version`,比对清单;开发模式仅告警 |

## 4. 隔离 env 与数据目录装配

```
PI_CODING_AGENT_DIR         = <dataDir>/pi-agent          # 双向隔离总开关(F1)
PI_CODING_AGENT_SESSION_DIR = <dataDir>/pi-agent/sessions
HTTP_PROXY / HTTPS_PROXY    = 预留空值(T8)
PIDESK_HOST                 = 1                            # 宿主标记(T1 沿革)
```

`<dataDir>` 解析:打包态 `app.getPath('userData')`;**开发态默认 `~/.pidesk-dev`**(可用 `PIDESK_DATA_DIR` 覆盖)——避免开发期污染打包态数据,也让隔离验收在 dev 环境可重复。

隔离目录 bootstrap(M1 最小 settings,M2 config-center 全量接管):

```jsonc
// <dataDir>/pi-agent/settings.json
{ "defaultProjectTrust": "never" }   // F6:非交互模式必须显式,否则项目资源静默失效
// <dataDir>/pi-agent/models.json —— 由设置表单生成(见 §6)
// <dataDir>/pi-agent/auth.json  —— 凭据落盘(仅当用户选择"保存"而非"仅环境变量")
```

**pi 二进制来源(开发模式回退,T3)**:`PIDESK_PI_PATH` > PATH 查找 `pi`(WSL 已装 0.85.1)> 报错指引自定义变量;打包态走 `resources/pi/pi.exe`(M1 末接线 electron-builder extraResources)。

## 5. IPC 契约(preload 白名单,一次定死)

invoke(renderer → main,应答式):

| 通道 | 载荷 | 返回 |
|------|------|------|
| `pidesk:session:create` | — | `{sessionId}` |
| `pidesk:session:prompt` | `{sessionId, message}` | `{ok}`(流式经事件通道) |
| `pidesk:session:abort` | `{sessionId}` | `{ok}` |
| `pidesk:session:getState` | `{sessionId}` | `RpcSessionState` |
| `pidesk:session:setModel` | `{sessionId, provider, modelId}` | `{ok}` |
| `pidesk:session:setThinkingLevel` | `{sessionId, level}` | `{ok}` |
| `pidesk:session:listModels` | `{sessionId}` | `{models[]}` |
| `pidesk:settings:getModelConfig` / `setModelConfig` | 连接配置对象 | 配置对象(凭据脱敏返回) |

push(main → renderer):

| 通道 | 载荷 |
|------|------|
| `pidesk:event` | `{sessionId, event: JsonAgentSessionEvent \| ExtensionUIRequest \| ExtensionError}` |
| `pidesk:process` | `{sessionId, state: 进程状态机状态}` |

规则:通道名全 `pidesk:` 前缀(T9);载荷类型全部定义在 `shared/ipc.ts`,main/preload/renderer 三方共用;preload 经 `contextBridge` 仅暴露上述方法,**不透传 ipcRenderer**;扩展 UI 请求(confirm/select/input)映射为渲染层对话框,M2 前仅 notify 走 toast。

## 6. 聊天面板(ui 包)与 provider 最小配置

组件树:`SessionView = SessionTabs + MessageList + Composer + ModelMenu(+SettingsDialog)`

- **MessageList**:单列 ≤72ch;`text_delta` 经 rAF 批量 flush(16ms 窗口)驱动 markdown 增量渲染;`thinking_delta` → 折叠摘要行;`toolcall_end` + `tool_execution_*` → 折叠行三态(呼吸点/✓+耗时/err+stderr);`message_update.usage` 累计 → 条目侧 token 计数(mono 12px)。
- **Composer**:Enter 发送 / Shift+Enter 换行;发送中变 ⏹ 中止;队列提示(steering/followUp 计数)。
- **ModelMenu**:左下角 `provider/model:thinking`;数据来自 `listModels`,思考档位 `get_available_thinking_levels` 四档。
- **SettingsDialog(provider 最小配置,M2 全量)**:单连接表单——预置 Ollama(`http://localhost:11434/v1`,T7)+「自定义 OpenAI 兼容」二选一;字段:baseUrl / apiKey(可选) / modelId;写入隔离 models.json(+auth.json 若选择保存);保存后重启 pi 进程生效。**M1 不做多 provider 列表管理**。
- 状态管理:M1 用 React context + reducer,**不引状态库**(依赖最小化;M3 工作流监视再评估)。

## 7. 安全清单落地(Electron)

contextIsolation:true;nodeIntegration:false;sandbox:renderer 开启;webSecurity 默认;CSP meta:仅加载自身资源(`default-src 'self'`);remote 模块禁用;devtools 仅开发态。

## 8. 双向隔离验收用例(L4,M1 出口)

| # | 步骤 | 预期 |
|---|------|------|
| A1 | pidesk 内完成一轮对话 → 终端跑全局 `pi -r`(默认 `~/.pi`) | 会话列表**不含** pidesk 会话 |
| A2 | 记录 `~/.pi` 目录 mtime → pidesk 完成一轮对话 → 复查 | `~/.pi` 无任何变化(含 sessions/skills/auth) |
| A3 | 全局 `~/.pi/agent/skills/` 放入测试 skill → pidesk `get_commands` | 命令列表**不含**该 skill |
| A4 | pidesk 隔离目录 `<dataDir>/pi-agent/sessions/` 直查 | 存在本轮会话 JSONL(证明落点在隔离区) |

## 9. M1 出口标准(验收包骨架,验收时展开为 acceptance 文档)

1. WSL dev 环境三会话并发对话稳定(流式/中止/切模型/思考档位);
2. §8 隔离用例 A1~A4 全绿;
3. `pnpm -r build && pnpm -r test` 绿(L1 ≥80% 红线:分帧器/状态机);
4. Windows 10+ 真机安装包可用,单会话对话 + A1/A4 抽查(用户实测清单);
5. UI 对照 ui-prototype §5.1 走查 + 可用性红线(dev-process §4.1)。

## 10. 开放问题(环节一裁决点)

1. **provider 配置**:M1 只支持"单连接"(同一时刻一个生效配置),还是"多套保存+单激活"?推荐**单连接**(最小化,M2 再扩展),少一半表单复杂度。
2. **dev 数据目录**默认 `~/.pidesk-dev`(`PIDESK_DATA_DIR` 可覆盖)是否接受?(隔离验收与日常开发共用一处,清理直观)

---

## 审阅指引(环节一)

1. **重点判定**:§4 隔离 env/dev 数据目录、§5 IPC 契约(签了字 M1 内不再改)、§6 provider 划界(单连接是否够用)。
2. §1 版本表无需逐项核对,系当日 registry 实查;TS 5.9 而非 7.0 是保守选择,不同意再说。
3. §8 隔离用例就是 M1 验收包的雏形——验收时你会拿到它的展开版(分步操作+预期结果)。

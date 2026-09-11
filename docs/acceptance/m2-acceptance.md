# M2 验收包(m2-acceptance)

> 环节二用户验收用(dev-process §8)。前置阅读:product-plan §11 M2、本包第五节已知问题。
> 自动化部分主线程已跑;标注【用户】的步骤需 harry 实操。本次不使用本地模型,请配置你自己的远端 provider。

## 一、M2 范围

config-center 全量(模型/凭据/中转/代理)、Skills 导入与启停、MCP 配置与 stdio bridge、flow-bridge(`flow_emit`);扩展 section 本版仅占位。

## 二、自动化验证(主线程已跑)

| # | 项 | 命令/方式 | 结果 |
|---|----|-----------|------|
| V1 | ESLint | `pnpm exec eslint .` | ✅ 0 error |
| V2 | 类型检查 | `pnpm -r typecheck` | ✅ 4 包通过 |
| V3 | 测试 | `pnpm -r test` | ✅ shared 11 + ui 64 + pi-host 70/1skip + desktop 31(config6/skills11/mcp9/ext5) |
| V4 | 构建 | `pnpm -r build` | ✅ 全通过 |
| V5 | MCP bridge 真联调 | mock stdio MCP server + 直接加载 `mcp-bridge.ts` | ✅ initialize / tools/list / tools/call 全通,注册 `mcp__mock__echo` |
| V6 | 配置中心 UI 渲染 | CDP 走查 | ✅ 模型与凭据/代理/Skills/MCP/扩展 section 可切换,provider 正常显示 |

## 三、用户走查【用户】(Windows 原生窗口)

准备:当前已启动干净的 Windows 原生 pidesk 窗口(独立 PIDESK_DATA_DIR,不含本地 Ollama 配置)。

### A. 模型与凭据 + 默认模型
1. 打开左侧「配置」→「模型与凭据」;
2. 点「新增连接」,填 id/name/baseUrl/modelId,按需填 API Key,保存;
3. 点「设为默认」;
4. 关闭窗口后重新打开应用,再次进入配置中心 → 该 provider 仍在,默认模型仍在。
判定:重启后配置持久 = 通过。

### B. 代理
1. 「代理」section 填 HTTP/HTTPS 代理,保存;
2. 重启后配置仍在。
判定:持久化 = 通过。

### C. Skills
1. 「Skills」→「导入 Skills 目录」,选一个含 `SKILL.md` 的目录;
2. 确认列表出现、可停用/启用、可删除;
3. 重启后状态持久。
判定:三项操作均生效且持久 = 通过。

### D. MCP
1. 「MCP」→「新增 MCP Server」,transport=stdio,填 command/args/env,保存;
2. 确认重启后配置仍在(生成 `<dataDir>/pi-agent/mcp-generated.json` 只含 enabled);
3. 新建会话,让模型调用 `mcp__<server>__<tool>`(需你已配置可用模型)。
判定:工具被注册并可调用 = 通过。

### E. 回归(可选但建议)
用你配置的远端模型完成一轮:发送/流式/思考中/中止/模型菜单切换。

## 四、判定标准

A+B+C+D 全过 → M2 功能通过;E 无阻塞问题 → M2 出口达成。
任一环节卡住记录步骤号与现象。

## 五、已知问题(验收时知悉)

1. 「扩展」section 仅占位;应用签名扩展分发未实现。
2. MCP bridge 目前只支持 stdio;SSE 传输未实现。
3. Playwright L3 E2E 尚未接入 CI(M2 流程项,计划下一卡补)。
4. Windows NSIS 未打包;当前用 Windows Electron 直接跑构建产物验收。
5. 按你要求,本轮所有测试未调用本地模型/Ollama。

## 六、回归清单(M2 后)

`pnpm exec eslint .` + `pnpm -r typecheck` + `pnpm -r test` + `pnpm -r build`;MCP bridge mock 自测脚本结果。

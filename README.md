# pidesk

基于 pi（@earendil-works/pi-coding-agent）的 Electron + React 桌面 AI 工作台：会话托管、配置中心、线性工作流。

## Monorepo 结构

pnpm workspace，目录布局：

```
packages/shared   @pidesk/shared — 协议类型字典 / IPC 契约 / 日志脱敏
packages/ui       （后续里程碑）React 组件与设计令牌
packages/pi-host  （后续里程碑）pi 运行时托管
apps/desktop      （后续里程碑）Electron 主进程 + 渲染进程
```

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm -r typecheck   # 全仓类型检查
pnpm -r test        # 全仓测试
pnpm -r build       # 全仓构建
```

依赖登记见 [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)。

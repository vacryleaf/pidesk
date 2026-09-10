# 依赖台账

> 报备制(dev-process.md §7):新增第三方依赖**无需批准,但必须告知**——① 登记本表;② 在相关验收汇报中向用户列明。
> 原则:仅在必须时引入;能用 Node/pi 生态既有能力解决的不引新包。

| 包 | 版本 | 类型 | 用途 | License | 引入日期 | 引入缘由 |
|----|------|------|------|---------|---------|---------|
| typescript | 5.9.3 | dev | 语言 | Apache-2.0 | 2026-09-10 | 全仓类型构建(m1-design §1) |
| vitest | 5.0.0 | dev | L1/L2 测试 | MIT | 2026-09-10 | dev-process §4 测试分层 |
| @earendil-works/pi-coding-agent | 0.85.1 | dev | 协议类型字典(DR-001) | MIT | 2026-09-10 | import type 零运行时,上游 400d6905 |
| eslint / @eslint/js / typescript-eslint | 10.10.0 / 10.0.1 / 8.70.0 | dev | 静态门槛(CI lint) | MIT | 2026-09-10 | dev-process §6;边界规则 no-restricted-imports |

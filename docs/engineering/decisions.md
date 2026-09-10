# pidesk 工程裁决档案(decisions)

> 开发期技术裁决记录(dev-process §9)。触发条件:协议变更、依赖类别新增、架构偏离既有裁决。
> S1 级裁决在 product-plan §2(T1-T9);流程裁决在 dev-process 文末(P1-P5)。

---

## DR-001 协议类型来源:devDependency + import type(方案 A)

- **日期**:2026-09-10
- **背景**:`packages/shared` 需要 pi RPC 协议类型(RpcCommand/RpcResponse/事件联合类型)。两案对比:A=devDependency 精确锁版本 + `import type`(类型编译期擦除,零运行时依赖);B=vendoring 抄写进 shared。上游类型闭包横跨 pi-ai / pi-agent-core / coding-agent 三包约 500~1000 行,B 人工同步易漏且静默漂移。
- **决定**:采用方案 A。`@earendil-works/pi-coding-agent` 入 devDependencies(精确版本),shared 以 `import type` 引用上游类型。
- **影响**:① DEPENDENCIES.md 登记首个 dev 依赖(实施于 M1 脚手架搭建时);② pi 升级对齐流程 = 升 dev 版本 + tsc 报错即改动清单 + regression-pi.sh 冒烟;③ 系 product-plan T2("宿主与 pi 同语言、类型直接 import")的落地具体化。

## DR-002 RPC 客户端超时分级与进程退出兜底参数

- **日期**:2026-09-10
- **背景**:pi-protocol §6/§8 的 pidesk 侧自研策略需要定初值。
- **决定**:
  1. 超时分级:即时类命令(get_state/set_*/get_*)5s;`prompt`(preflight 响应)30s;`compact` 120s;`bash`/`export_html` 不设超时(事件驱动 + abort/abort_bash 兜底);
  2. 进程退出兜底:`stdin.end()` 优雅停 → 宽限 3s → SIGTERM → 再 2s → `taskkill /T`(Windows)/ SIGKILL 树杀。
- **影响**:pi-host 实现按此参数落常量(集中定义,可配);初值在 M1 实测后可经 DR 修订。

# M1 验收包(m1-acceptance)

> 环节二用户验收用(dev-process §8)。前置阅读:m1-design §9 出口标准、manual-checklist。
> 自动化部分主线程已跑并附结果;标注【用户】的步骤需 harry 实操。

## 一、前置条件

1. WSL Ubuntu(harry),仓库 `/home/harry/pidesk`,依赖已装(`pnpm install`,用 `~/.npm-global/bin/pnpm`);
2. 本机 pi 0.85.1(`/usr/local/bin/pi`);Ollama `localhost:11434` 可达(默认模型连接);
3. 桌面环境可用(WSLg)——Electron 窗口需图形支持。

## 二、自动化验证(主线程已跑,复核命令附后)

| # | 项 | 命令 | 结果(2026-09-10) |
|---|----|------|------------------|
| V1 | 全仓类型检查 | `pnpm -r typecheck` | ✅ 4 包 Done |
| V2 | 全仓测试 | `pnpm -r test` | ✅ shared 11 + ui 64 + pi-host 70/1skip |
| V3 | L1 覆盖率红线 | `pnpm --filter @pidesk/pi-host test:coverage` | ✅ 全包 Lines 94.47%(分帧器 95%/状态机 90%) |
| V4 | L4 双向隔离 | `bash scripts/isolation-check.sh` | ✅ 3 PASS 1 SKIP(A3 需手动,见 B2) |
| V5 | L4 升级冒烟 | `bash scripts/regression-pi.sh` | ✅ 4 PASS |
| V6 | 构建 | `pnpm -r build` | ✅ |
| V7 | ESLint | `pnpm exec eslint .` | ✅ 0 问题 |

## 三、用户走查【用户】

### B1 会话核心操作(出口标准①:三会话并发)
1. `pnpm --filter @pidesk/desktop dev` 启动应用 → 窗口出现,左侧导航栏(会话激活,蓝窄条);
2. 会话页点「新建会话」→ 标签出现;
3. 输入框输入"你好"回车 → 流式回复出现(思考折叠行/工具折叠行按需出现),条目右侧 token 计数增长;
4. 左下角 `provider/model:thinking` 菜单 → 切换模型/思考档位 → 再发一条消息生效;
5. 发送中点 ⏹ → 流中止,Composer 复位;
6. 重复 1-3 建立共 3 个会话标签,轮流各发一条消息 → 三会话互不串扰;
7. 左下角「配置」→ 设置弹窗 → 保存 → toast 提示"重启会话后生效"。

判定:以上 7 步无卡点完成=通过;任一步骤卡住记录步骤号与现象。

### B2 双向隔离 A3 手动补验(L4 收尾)
1. 全局目录建测试 skill:`mkdir -p ~/.pi/agent/skills/test-skill && printf -- "---\nname: test-skill\n---\n测试用" > ~/.pi/agent/skills/test-skill/SKILL.md`;
2. 在 pidesk 会话输入 `/`(斜杠命令列表)→ 确认**不含** test-skill;
3. 清理:删除 `~/.pi/agent/skills/test-skill`。

### B3 可用性红线(无人讲解可完成)
- 以"第一次接触"视角重走 B1-1~B1-3,任何一步需看文档才能完成 → 记录为问题。

## 四、Windows 真机【用户,CI 产物】

1. push 后 GitHub Actions → windows job 产物 NSIS 安装包(artifacts);
2. 安装 → 启动 → 单会话对话(等价 B1-1~B1-3);
3. 隔离抽查:安装版对话后,Windows 侧全局 `%USERPROFILE%\.pi` 无新会话;`%APPDATA%/pidesk/pi-agent/sessions` 有会话文件(等价 A1/A4)。

## 五、判定标准

- B1 全过 + B2 通过 + B3 无阻塞问题 → WSL 侧验收通过;
- 四-2/3 通过 → Windows 侧验收通过;
- 两者皆过 → M1 出口达成(m1-design §9 全条目闭环)。

## 六、已知问题(验收时知悉,不算失败)

1. A3 自动化 SKIP(脚本无全局 skill 预置权限)——B2 手动覆盖;
2. extension_ui_request 的 confirm/select/input:main 侧已入队,渲染呈现于 M2 接(本版扩展请求仅 notify 透传);
3. 崩溃重启后至下一次 invoke 间的新进程事件不推送(惰性重挂,M2 由池补钩子);
4. saveKey=false 不清除 auth.json 既有 key(M2 env 注入时一并裁决);
5. settings 变更生效需重启会话(managed 重启已实现,UI 未做一键按钮)。

## 七、回归清单(pi 换版本时)

`bash scripts/regression-pi.sh`(四项)+ `bash scripts/isolation-check.sh`(双向隔离)+ V1/V2/V7。

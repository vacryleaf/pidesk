import { defineConfig } from 'vitest/config'

// 根级统一测试入口:projects 模式聚合各包(vitest 5 语法,defineWorkspace 已移除)
// 各包自带 vitest.config.ts;覆盖率红线(L1 ≥80%)经本入口汇总核验
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
})

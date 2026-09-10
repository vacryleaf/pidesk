import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // DOM 组件测试必需(jsdom,已登记 docs/DEPENDENCIES.md)
    environment: 'jsdom',
  },
})

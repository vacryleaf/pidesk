import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // L2 真机集成测试(T7b)在 l2/ 下,一并收集;真 pi 缺席时用例自身 skipIf 跳过
    include: ['src/**/*.test.ts', 'l2/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
})

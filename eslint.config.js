// pidesk 根 ESLint flat config:基础规约 + 包边界约束(单向依赖 desktop→ui→pi-host→shared)
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/.pidesk-dev/**", "**/dist/**", "**/node_modules/**", "**/coverage/**", "**/out/**", "resources/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // TS 项目:no-undef 交由 tsc 管理(ESLint 无法解析 TS 类型与 DOM 全局)
  { rules: { "no-undef": "off" } },
  // 包边界:核心 no-restricted-imports 仅按导入路径匹配,按文件位置分段用 flat config 的 files 覆盖
  {
    files: ["packages/shared/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@pidesk/ui", "@pidesk/pi-host", "@pidesk/desktop"], message: "shared 是最底层包,禁止反向依赖" }] }] },
  },
  {
    files: ["packages/pi-host/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@pidesk/ui", "@pidesk/desktop"], message: "pi-host 禁止依赖 ui/desktop" }] }] },
  },
  {
    files: ["packages/ui/**/*.ts", "packages/ui/**/*.tsx"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@pidesk/desktop"], message: "ui 禁止依赖 desktop" }] }] },
  },
);

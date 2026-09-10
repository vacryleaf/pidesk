// pidesk 根 ESLint flat config:基础规约 + 包边界约束
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // 构建产物与依赖不参与 lint
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 包边界(zones):按目录锁定可引用的包,防止反向依赖
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          zones: [
            {
              // packages/shared 是最底层:禁止依赖 ui / pi-host / desktop
              path: "packages/shared",
              imports: [
                { package: "@pidesk/ui" },
                { package: "@pidesk/pi-host" },
                { package: "@pidesk/desktop" },
              ],
            },
            {
              // packages/pi-host:禁止依赖 ui / desktop
              path: "packages/pi-host",
              imports: [
                { package: "@pidesk/ui" },
                { package: "@pidesk/desktop" },
              ],
            },
            {
              // packages/ui:禁止依赖 desktop
              path: "packages/ui",
              imports: [{ package: "@pidesk/desktop" }],
            },
            // apps/* 不受限
          ],
        },
      ],
    },
  }
);

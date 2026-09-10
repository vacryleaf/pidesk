import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// 三进程构建:main/preload(node) + renderer(web)
// 安全基线(m1-design §7):contextIsolation/nodeIntegration/sandbox 在 main 源码 BrowserWindow 配置,不在此处
export default defineConfig({
  main: {
    // workspace 包(@pidesk/*)源码按 bundler 解析(无扩展名导入),须打包进 main 产物而非外置
    build: { rollupOptions: { external: [/^electron$/, /^node:/] } },
  },
  preload: {
    build: { rollupOptions: { external: [/^electron$/, /^node:/] } },
  },
  renderer: {
    plugins: [react()],
  },
});

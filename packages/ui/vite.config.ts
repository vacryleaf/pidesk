import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// T2c 起 renderer 接入;当前 ui 包以 tsc 构建,vite 配置就位备用
export default defineConfig({
  plugins: [react()],
});

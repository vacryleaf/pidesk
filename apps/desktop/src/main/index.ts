// 主进程入口(m1-design §7 安全基线)
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerIpcHandlers } from "./ipc.js";
import { PiHostManager } from "./pi-host-manager.js";

// 创建主窗口:默认尺寸 1280×800,最小 960×640
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    // 安全清单:启用上下文隔离、禁用 Node 集成、启用沙箱;webSecurity 保持默认(true)
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // preload 通过 electron-vite 构建产物路径引用
      preload: fileURLToPath(new URL("../preload/index.js", import.meta.url)),
    },
  });

  // 开发态(electron-vite 注入环境变量)加载 dev server,生产态加载构建产物
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(
      fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
    );
  }
  return win;
}

// 生命周期:ready 后建窗口,再接线 IPC(T8a)
app.whenReady().then(() => {
  const win = createWindow();
  const manager = new PiHostManager();
  registerIpcHandlers(ipcMain, manager, win);
});

// 全窗口关闭时退出(linux/win 无 dock 驻留需求,统一 quit)
app.on("window-all-closed", () => {
  app.quit();
});

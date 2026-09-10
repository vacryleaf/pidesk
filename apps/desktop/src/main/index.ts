// 主进程入口(m1-design §7 安全基线)
import * as fs from "node:fs";
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

  // 渲染诊断(开发态):把 renderer 的 console/加载失败回传主进程日志
  const wc = win.webContents;
  wc.on("console-message", (_e, level, message) => {
    if (process.env.PIDESK_DEV_DEBUG) console.log(`[renderer:${level}]`, message);
  });
  wc.on("did-fail-load", (_e, code, desc, url) =>
    console.error(`[did-fail-load] ${code} ${desc} ${url}`),
  );
  wc.on("preload-error", (_e, path, err) =>
    console.error(`[preload-error] ${path}`, err),
  );
  wc.on("render-process-gone", (_e, details) =>
    console.error(`[render-process-gone]`, details.reason),
  );

  // 视觉自检(开发态):加载完成后截图到 /tmp/pidesk-screen.png,供主线程核验 UI 渲染
  if (process.env.PIDESK_DEV_DEBUG) {
    wc.once("did-finish-load", () => {
      setTimeout(() => {
        void wc
          .capturePage()
          .then((img) => {
            fs.writeFileSync("/tmp/pidesk-screen.png", img.toPNG());
            console.log("[screenshot] /tmp/pidesk-screen.png");
          })
          .catch((err) => console.error("[screenshot]", err));
      }, 2500);
    });
  }
  return win;
}

// WSL/无 GPU 环境:禁用 GPU 加速与浏览器级沙箱(Chromium 需 setuid helper),
// 仅 WSL 生效(WSL_DISTRO_NAME 由 WSL 自动注入);Windows 生产态不受影响
if (process.env.WSL_DISTRO_NAME) {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  // /dev/shm 权限受限的 WSL 环境:共享内存改用 /tmp
  app.commandLine.appendSwitch("disable-dev-shm-usage");
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

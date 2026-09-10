// 主进程入口(m1-design §7 安全基线)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { resolveDataDir } from "@pidesk/shared";
import { registerIpcHandlers } from "./ipc.js";
import { PiHostManager } from "./pi-host-manager.js";

// 创建主窗口:默认尺寸 1280×800,最小 960×640
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    // 无边框窗口(参考 Wegent):macOS 保留红绿灯,其它平台完全无边框、由自定义标题栏控制
    ...(process.platform === "darwin"
      ? {
          frame: true,
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 12 },
        }
      : { frame: false, titleBarStyle: "hidden" as const }),
    backgroundColor: "#181818",
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

  // 注意:WSLg 劣化态下 capturePage 会触发 renderer crash(共享内存 ESRCH),
  // 视觉验证改用浏览器开 renderer URL 或肉眼;capturePage 仅在正常桌面环境启用
  return win;
}

// WSL/无 GPU 环境:禁用 GPU 加速与浏览器级沙箱(Chromium 需 setuid helper),
// 仅 WSL 生效(WSL_DISTRO_NAME 由 WSL 自动注入);Windows 生产态不受影响
if (process.env.WSL_DISTRO_NAME) {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  // WSLg Wayland 环境需在启动 Electron 的 shell 中已存在;
  // 进程内晚设 WAYLAND_DISPLAY/XDG_RUNTIME_DIR 会触发 /dev/shm 共享内存崩溃
  const wslgWaylandSocket = "/mnt/wslg/runtime-dir/wayland-0";
  const useWslgWayland =
    process.platform === "linux" &&
    process.env.PIDESK_OZONE !== "x11" &&
    Boolean(process.env.WAYLAND_DISPLAY) &&
    existsSync(wslgWaylandSocket);

  if (useWslgWayland) {
    app.commandLine.appendSwitch("ozone-platform", "wayland");
    app.commandLine.appendSwitch("enable-wayland-ime");
  } else {
    // 旧 X11 退路:共享内存改用 /tmp
    app.commandLine.appendSwitch("disable-dev-shm-usage");
  }
}

// 生命周期:ready 后建窗口,再接线 IPC(T8a)
app.whenReady().then(() => {
  const win = createWindow();
  // 对齐 m1-design §5:打包态 userData,开发态 .pidesk-dev
  const dataDir = app.isPackaged ? app.getPath("userData") : resolveDataDir(process.env);
  const manager = new PiHostManager(dataDir);
  registerIpcHandlers(ipcMain, manager, win);
});

// 全窗口关闭时退出(linux/win 无 dock 驻留需求,统一 quit)
app.on("window-all-closed", () => {
  app.quit();
});

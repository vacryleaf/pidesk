// 渲染进程全局类型:window.pidesk 白名单桥(类型面与 preload 实现同源,取自 shared 契约)
import type { PideskBridge } from "@pidesk/shared";

declare global {
  interface Window {
    pidesk: PideskBridge;
  }
}

export {};

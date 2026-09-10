// preload 桥接层:仅暴露空命名空间占位,后续任务卡再填充
// 安全约束:禁止透传 ipcRenderer 或任何 Node API 到渲染进程
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("pidesk", {});

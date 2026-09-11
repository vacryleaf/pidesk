// 渲染进程根组件(T10b + M2):SessionsProvider 包导航壳;设置态整页换 ConfigCenter。
// 工作流/运行两个导航项本阶段仍为禁用占位(nav-shell 内),后续里程碑接入。
import { useEffect, useState } from "react";
import { ConfigCenter, NavShell, SessionView, SessionsProvider } from "@pidesk/ui";
import { WindowControls } from "./window-controls";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <SessionsProvider>
      <DevDomProbe />
      <WindowControls />
      <NavShell onOpenSettings={() => setSettingsOpen(true)} activeKey={settingsOpen ? "settings" : "sessions"}>
        {settingsOpen ? <ConfigCenter onClose={() => setSettingsOpen(false)} /> : <SessionView />}
      </NavShell>
    </SessionsProvider>
  );
}

// 开发诊断:挂载后上报 DOM 文本指纹(经 console-message 转主进程日志)
export function DevDomProbe() {
  useEffect(() => {
    const t = setTimeout(() => {
      console.log("[ui-ready]", document.body.innerText.slice(0, 120).replace(/\n/g, "|"));
    }, 1200);
    return () => clearTimeout(t);
  }, []);
  return null;
}

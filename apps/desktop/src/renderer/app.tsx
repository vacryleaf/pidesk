// 渲染进程根组件(T10b):SessionsProvider 包导航壳;会话主区换真 SessionView。
// 工作流/运行/配置三个导航项本阶段仍为禁用占位(nav-shell 内),后续里程碑接入。
import { useEffect, useState } from "react";
import { NavShell, SessionView, SessionsProvider, SettingsDialog } from "@pidesk/ui";
import { WindowControls } from "./window-controls";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <SessionsProvider>
      <DevDomProbe />
      <WindowControls />
      <NavShell onOpenSettings={() => setSettingsOpen(true)}>
        <SessionView />
      </NavShell>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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

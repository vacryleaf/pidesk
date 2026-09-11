// 渲染进程根组件(T10b + M2):SessionsProvider 包导航壳;设置态整页换 ConfigCenter。
// 外壳为 VS Code 式:顶部整行 titlebar(左 pidesk,右窗口控制),下方菜单/内容双圆角面板。
// 工作流/运行两个导航项本阶段仍为禁用占位(nav-shell 内),后续里程碑接入。
import { useEffect, useState } from "react";
import { ConfigCenter, NavShell, SessionView, SessionsProvider } from "@pidesk/ui";
import { WindowControls } from "./window-controls";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <SessionsProvider>
      <DevDomProbe />
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-1)]">
        {/* 顶部整行标题栏:左侧产品名,右侧窗口控制按钮 */}
        <header className="titlebar-drag flex h-[52px] w-full shrink-0 items-center justify-between bg-[var(--bg-0)] pl-3">
          <span className="text-[18px] font-semibold leading-6 text-[var(--text-0)]">pidesk</span>
          <WindowControls />
        </header>
        {/* 下方区域:圆角导航面板 + 圆角内容面板 */}
        <div className="min-h-0 flex-1 p-2">
          <NavShell contentBare={settingsOpen} onOpenSessions={() => setSettingsOpen(false)} onOpenSettings={() => setSettingsOpen(true)} activeKey={settingsOpen ? "settings" : "sessions"}>
            {settingsOpen ? <ConfigCenter /> : <SessionView />}
          </NavShell>
        </div>
      </div>
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

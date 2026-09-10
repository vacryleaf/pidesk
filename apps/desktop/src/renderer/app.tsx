// 渲染进程根组件(T10b):SessionsProvider 包导航壳;会话主区换真 SessionView。
// 工作流/运行/配置三个导航项本阶段仍为禁用占位(nav-shell 内),后续里程碑接入。
import { NavShell, SessionView, SessionsProvider } from "@pidesk/ui";

export default function App() {
  return (
    <SessionsProvider>
      <NavShell>
        <SessionView />
      </NavShell>
    </SessionsProvider>
  );
}

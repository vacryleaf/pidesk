// 渲染进程根组件(T2c):导航壳 + 会话占位页;会话主区 T10b 换真
import { NavShell, Placeholder } from "@pidesk/ui";

export default function App() {
  return (
    <NavShell>
      <Placeholder title="会话" />
    </NavShell>
  );
}

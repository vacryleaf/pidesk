// 渲染进程入口:挂载 React(沙箱环境,禁 require/Ndo API)
import { createRoot } from "react-dom/client";
import "./app.css";
import App from "./app";

// 挂载到 index.html 中的 #root 节点
const container = document.getElementById("root");
if (!container) throw new Error("缺少 #root 挂载点");
createRoot(container).render(<App />);

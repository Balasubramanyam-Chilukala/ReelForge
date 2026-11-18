import { useEffect } from "react";
import { useStore, type View } from "./store.js";
import { Home } from "./components/Home.js";
import { Workspace } from "./components/Workspace.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { AgentIntegration } from "./components/AgentIntegration.js";
import { Settings } from "./components/Settings.js";

const TABS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "editor", label: "Editor" },
  { id: "export", label: "Export" },
  { id: "agents", label: "AI Agents" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const { view, setView, connection, wsOpen, connect, doc } = useStore();

  useEffect(() => {
    void connect();
  }, [connect]);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">
          <span className="dot" /> ReelForge
        </div>
        <div className="navtabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={view === t.id ? "active" : ""}
              onClick={() => setView(t.id)}
              disabled={(t.id === "editor" || t.id === "export") && !doc}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {doc && <span className="badge">{doc.name}</span>}
        <div className={`conn ${connection}`}>
          <span className="dot" />
          {connection === "connected" ? (wsOpen ? "Connected" : "Connected (no live events)") : connection}
        </div>
      </div>

      {view === "home" && <Home />}
      {view === "editor" && (doc ? <Workspace /> : <NeedProject />)}
      {view === "export" && (doc ? <ExportPanel /> : <NeedProject />)}
      {view === "agents" && <AgentIntegration />}
      {view === "settings" && <Settings />}
    </div>
  );
}

function NeedProject() {
  const setView = useStore((s) => s.setView);
  return (
    <div className="empty" style={{ marginTop: 60 }}>
      No project open. <a onClick={() => setView("home")}>Go to Home</a> to create or open one.
    </div>
  );
}

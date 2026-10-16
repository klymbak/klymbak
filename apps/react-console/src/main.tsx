import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentChat, AgentWidget, AgentWorkspace, KlymbakProvider, configureFormatting, useAgentStore } from "@klymbak/react";
import "@klymbak/react/style.css";
import "./playground.css";

configureFormatting({ locale: "en-US" });

// The demo API fakes sign-in with a header (see apps/acme-api); a real app sends its session cookie.
const headers = { "x-demo-user": "admin" };

type Mode = "workspace" | "chat" | "widget";
type Theme = "auto" | "light" | "dark";

function SessionPicker() {
  const store = useAgentStore();
  return (
    <select
      aria-label="Conversation"
      value={store.state.sessionId ?? ""}
      onChange={(event) => (event.target.value ? void store.openSession(event.target.value) : store.newSession())}
    >
      <option value="">New conversation</option>
      {store.state.sessions.map((session) => (
        <option key={session.id} value={session.id}>
          {session.title}
        </option>
      ))}
    </select>
  );
}

function Playground() {
  const [mode, setMode] = useState<Mode>("workspace");
  const onAction = (action: unknown) => console.info("[playground] action", action);
  const [theme, setTheme] = useState<Theme>("light");

  return (
    <KlymbakProvider baseUrl="/api/agent" headers={headers}>
      <div className="playground" data-theme={theme}>
        <header className="playground__bar">
          <strong>@klymbak/react</strong>
          <select aria-label="Layout" value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
            <option value="workspace">Workspace</option>
            <option value="chat">Chat</option>
            <option value="widget">Widget</option>
          </select>
          {mode !== "workspace" && <SessionPicker />}
          <select aria-label="Theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="auto">Auto</option>
          </select>
        </header>
        <main className="playground__main">
          {mode === "workspace" ? (
            <AgentWorkspace theme={theme} onAction={onAction} />
          ) : mode === "chat" ? (
            <AgentChat theme={theme} showMeta onAction={onAction} />
          ) : (
            <>
              <p className="playground__page">An existing admin page. The agent sits in the corner.</p>
              <AgentWidget theme={theme} label="Ask the agent" />
            </>
          )}
        </main>
      </div>
    </KlymbakProvider>
  );
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);

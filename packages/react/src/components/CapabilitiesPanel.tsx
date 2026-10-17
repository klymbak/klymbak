import { useState, type FormEvent } from "react";
import type { ToolInfo } from "@klymbak/protocol";
import { useAgentStore } from "../context";
import { KlIcon } from "./KlIcon";

const EMPTY_FORM = { name: "", url: "", token: "" };

export function CapabilitiesPanel() {
  const store = useAgentStore();
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const { config } = store.state;
  if (!config) return null;

  const tools = config.tools;
  const groups = [
    { key: "local", title: "App actions", icon: "tool", tools: tools.filter((t) => t.source === "local") },
    ...[...new Set(tools.filter((t) => t.source === "mcp").map((t) => t.server!))].map((server) => ({
      key: `mcp:${server}`,
      title: `${server} (MCP)`,
      icon: "plug",
      tools: tools.filter((t) => t.source === "mcp" && t.server === server),
    })),
    { key: "builtin", title: "Built-in", icon: "clock", tools: tools.filter((t) => t.source === "builtin" || t.source === "subagent") },
  ].filter((s): s is { key: string; title: string; icon: string; tools: ToolInfo[] } => s.tools.length > 0);

  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  async function connect(event: FormEvent) {
    event.preventDefault();
    setAddError("");
    setAdding(true);
    try {
      const headers = form.token ? { authorization: `Bearer ${form.token}` } : undefined;
      const server = await store.addMcpServer(form.name.trim(), form.url.trim(), headers);
      if (server.status === "error") setAddError(server.error ?? "Couldn't connect.");
      else setForm(EMPTY_FORM);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Couldn't connect.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="kl-caps">
      <p className="kl-caps__intro">
        What the agent can do for <strong>{config.user.name}</strong>
        {" "}
        <span className="kl-faint">({config.user.roles.join(", ")})</span>. Actions marked <span className="kl-pill kl-tone-warning">asks first</span> wait
        for your approval.
      </p>

      {config.subagents.length > 0 && (
        <section className="kl-caps__section">
          <h4>
            <KlIcon name="agents" size={14} /> Specialists
          </h4>
          {config.subagents.map((agent) => (
            <div key={agent.name} className="kl-cap">
              <div className="kl-cap__top">
                <span className="kl-cap__name" style={{ textTransform: "capitalize" }}>
                  {agent.name}
                </span>
              </div>
              <p className="kl-cap__desc">{agent.description}</p>
              <p className="kl-cap__tools kl-faint">{agent.tools.length} tools</p>
            </div>
          ))}
        </section>
      )}

      {config.skills.length > 0 && (
        <section className="kl-caps__section">
          <h4>
            <KlIcon name="file" size={14} /> Skills <span className="kl-faint">{config.skills.length}</span>
          </h4>
          {config.skills.map((skill) => (
            <div key={skill.name} className="kl-cap">
              <div className="kl-cap__top">
                <span className="kl-cap__name">{skill.name}</span>
              </div>
              <p className="kl-cap__desc">{skill.description}</p>
            </div>
          ))}
        </section>
      )}

      {groups.map((group) => (
        <section key={group.key} className="kl-caps__section">
          <h4>
            <KlIcon name={group.icon} size={14} /> {group.title} <span className="kl-faint">{group.tools.length}</span>
          </h4>
          {group.tools.map((tool) => (
            <div key={tool.name} className="kl-cap">
              <div className="kl-cap__top">
                <span className="kl-cap__name">{tool.label}</span>
                {tool.approval !== "never" ? (
                  <span className="kl-pill kl-tone-warning">{tool.approval === "always" ? "asks first" : "may ask"}</span>
                ) : (
                  tool.readOnly && <span className="kl-pill">read-only</span>
                )}
              </div>
              <p className="kl-cap__desc">{tool.description}</p>
            </div>
          ))}
        </section>
      ))}

      <section className="kl-caps__section">
        <h4>
          <KlIcon name="plug" size={14} /> Integrations
        </h4>
        {config.mcpServers.map((server) => (
          <div key={server.name} className="kl-mcp">
            <span className={`kl-mcp__dot kl-mcp__dot--${server.status}`} title={server.status} />
            <div className="kl-mcp__body">
              <span className="kl-cap__name">{server.name}</span>
              <span className="kl-faint">
                {server.transport} · {server.tools.length} tools · {server.status}
              </span>
              {server.error && <span className="kl-mcp__error">{server.error}</span>}
            </div>
            {server.runtime && config.features.runtimeMcp && (
              <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => void store.removeMcpServer(server.name)}>
                Remove
              </button>
            )}
          </div>
        ))}
        {!config.mcpServers.length && <p className="kl-faint">No MCP servers connected.</p>}

        {config.features.runtimeMcp && (
          <form className="kl-mcp-form" onSubmit={connect}>
            <span className="kl-mcp-form__title">Connect an MCP server</span>
            <input className="kl-input" required pattern="[A-Za-z0-9_-]+" placeholder="Name, e.g. stripe" aria-label="Server name" {...field("name")} />
            <input className="kl-input" required type="url" placeholder="https://mcp.example.com/mcp" aria-label="Server URL" {...field("url")} />
            <input
              className="kl-input"
              type="password"
              placeholder="Bearer token (optional)"
              aria-label="Bearer token"
              autoComplete="off"
              {...field("token")}
            />
            {addError && <p className="kl-mcp__error">{addError}</p>}
            <button type="submit" className="kl-btn kl-btn--sm" disabled={adding}>
              {adding && <span className="kl-spinner" />} Connect
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

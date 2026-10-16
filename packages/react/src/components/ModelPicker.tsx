import { useEffect, useRef, useState } from "react";
import type { ModelInfo, ThinkingLevel } from "@klymbak/protocol";
import { formatContext, selectCurrentModel, selectModels } from "@klymbak/client";
import { useAgentStore } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

export function ModelPicker({ placement = "up" }: { placement?: "up" | "down" }) {
  const store = useAgentStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const models = selectModels(store.state);
  const current = selectCurrentModel(store.state);
  const levels: ThinkingLevel[] = current?.reasoning ? current.thinkingLevels.filter((l) => l !== "minimal") : [];

  const q = query.trim().toLowerCase();
  const groups = new Map<string, { provider: string; name: string; models: ModelInfo[] }>();
  for (const model of models) {
    if (q && !`${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(q)) continue;
    const group = groups.get(model.provider) ?? { provider: model.provider, name: model.providerName, models: [] };
    group.models.push(model);
    groups.set(model.provider, group);
  }

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const isCurrent = (model: ModelInfo) => store.state.model?.provider === model.provider && store.state.model?.id === model.id;

  function toggle() {
    if (!open) setQuery("");
    setOpen(!open);
  }

  function choose(model: ModelInfo) {
    store.setModel({ provider: model.provider, id: model.id });
    setOpen(false);
  }

  return (
    <div
      ref={root}
      className="kl-models"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button type="button" className="kl-models__button" aria-expanded={open} aria-haspopup="listbox" onClick={toggle}>
        <span className="kl-models__name">{current?.name ?? (models.length ? "Choose a model" : "No models")}</span>
        {current && <span className="kl-models__provider">{current.providerName}</span>}
        {current?.reasoning && store.state.thinkingLevel !== "off" && (
          <span className="kl-pill kl-tone-accent">think: {store.state.thinkingLevel}</span>
        )}
        <KlIcon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className={`kl-models__panel kl-models__panel--${placement}`} role="listbox">
          <input
            ref={search}
            className="kl-input"
            type="search"
            placeholder="Search models"
            aria-label="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="kl-models__groups kl-scroll">
            {[...groups.values()].map((group) => (
              <div key={group.provider} className="kl-models__group">
                <span className="kl-models__group-name">{group.name}</span>
                {group.models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    className={cx("kl-models__option", isCurrent(model) && "kl-models__option--active")}
                    aria-selected={isCurrent(model)}
                    onClick={() => choose(model)}
                  >
                    <span className="kl-models__option-name">{model.name}</span>
                    <span className="kl-models__badges">
                      {model.local && <span className="kl-pill kl-tone-success">local</span>}
                      {model.reasoning && <span className="kl-pill kl-tone-accent">reasoning</span>}
                      {model.input.includes("image") && <span className="kl-pill">vision</span>}
                      <span className="kl-faint kl-num">{formatContext(model.contextWindow)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.size && (
              <p className="kl-models__empty">
                {models.length ? "No models match." : "No providers are configured on the server. Add an API key or a local model server."}
              </p>
            )}
          </div>
          {levels.length > 1 && (
            <div className="kl-models__thinking">
              <span>Thinking</span>
              <div className="kl-segmented" role="radiogroup" aria-label="Thinking level">
                {levels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={store.state.thinkingLevel === level}
                    className={store.state.thinkingLevel === level ? "active" : undefined}
                    onClick={() => store.setThinkingLevel(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

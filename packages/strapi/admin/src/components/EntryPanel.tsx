import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Box, Button, Flex, Textarea, Typography } from "@strapi/design-system";
import { Cross, Sparkle } from "@strapi/icons";
import * as StrapiAdmin from "@strapi/strapi/admin";
import { AgentChat, createAgentClient, createAgentStore, type AgentStore, type ChatMessage, type ToolPart } from "@klymbak/react";
import "@klymbak/react/style.css";
import { agentUrl, PERMISSIONS, useAdminFetch, useAgentActions } from "../agent";
import { StrapiTheme, useStrapiThemeMode } from "../theme";

/** What the Content Manager passes to edit-view side panels. */
export interface EditViewContext {
  activeTab: "draft" | "published" | null;
  collectionType: string;
  document?: Record<string, unknown> & { documentId?: string; locale?: string | null };
  documentId?: string;
  meta?: unknown;
  model: string;
}

const QUICK_PROMPTS = ["Summarize this entry", "What's missing before I publish it?", "Suggest improvements to the text"];
/** Tools that change an entry, ours and Strapi MCP's: after one, the form shows stale data. */
const WRITE_TOOL = /^(update_entry|publish_entry|unpublish_entry|discard_draft|strapi_(update|write|publish|unpublish|discard)_.+)$/;
/** Conversations by entry, so coming back to an entry in this tab reopens its conversation. */
const conversations = new Map<string, string>();

type Hook = (...args: never[]) => unknown;
const admin = StrapiAdmin as unknown as Record<string, Hook | undefined>;
// Strapi marks the document hook unstable; without it the panel just can't refresh the form.
const useDocument = (admin.unstable_useDocument ?? (() => undefined)) as (args: { model: string; collectionType: string; documentId?: string; params?: object }) =>
  | { refetch?: () => void; schema?: { info?: { displayName?: string } }; getTitle?: (field: string) => string }
  | undefined;
const useDocumentLayout = (admin.unstable_useDocumentLayout ?? (() => undefined)) as (model: string) => { edit?: { settings?: { mainField?: string } } } | undefined;
const useForm = (admin.useForm ?? (() => false)) as <T>(consumer: string, selector: (form: { modified: boolean }) => T, shouldThrow?: boolean) => T | undefined;

function describeEntry(props: EditViewContext, name: string, title: string | undefined): string {
  const single = props.collectionType === "single-types";
  if (!props.documentId && !single) {
    return `A new ${name} entry (content type ${props.model}) that hasn't been saved yet: nothing is stored, and you can't see what is in the form.`;
  }
  const locale = props.document?.locale ?? undefined;
  const details = [
    `content type ${props.model}`,
    single ? "single type, no documentId needed" : `documentId ${props.documentId}`,
    locale ? `locale ${locale}` : "",
    props.activeTab ? `viewing the ${props.activeTab} version` : "",
  ].filter(Boolean);
  return `The ${name} entry open in the Content Manager${title ? ` "${title}"` : ""} (${details.join(", ")}). Unsaved edits in the form are not visible to you.`;
}

function changedEntry(messages: ChatMessage[], documentId: string | undefined, seen: Set<string>): boolean {
  let changed = false;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || seen.has(part.toolCallId)) continue;
      const tool = part as ToolPart;
      if (!WRITE_TOOL.test(tool.name) || tool.status !== "done" || tool.result?.isError) continue;
      seen.add(tool.toolCallId);
      const args = tool.args as { documentId?: string } | undefined;
      if (!documentId || !args?.documentId || args.documentId === documentId) changed = true;
    }
  }
  return changed;
}

function EntryAssistant(props: EditViewContext) {
  const { model, collectionType, documentId } = props;
  const fetch = useAdminFetch();
  const theme = useStrapiThemeMode();
  const onAction = useAgentActions();
  const locale = props.document?.locale ?? undefined;
  const key = `${model}:${documentId ?? "single"}:${locale ?? ""}`;

  const doc = useDocument({ model, collectionType, documentId, params: locale ? { locale } : {} });
  const layout = useDocumentLayout(model);
  const modified = useForm("KlymbakAssistant", (form) => form.modified, false) === true;
  const name = doc?.schema?.info?.displayName ?? model.split(".").pop() ?? "entry";
  const mainField = layout?.edit?.settings?.mainField;
  const title = mainField && mainField !== "id" ? (doc?.getTitle?.(mainField) ?? String(props.document?.[mainField] ?? "")) : undefined;

  const [store] = useState<AgentStore>(() => createAgentStore({ client: createAgentClient({ baseUrl: agentUrl(), fetch }) }));
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [stale, setStale] = useState(false);
  const handled = useRef(new Set<string>());
  const latest = useRef({ modified, refetch: doc?.refetch });
  latest.current = { modified, refetch: doc?.refetch };

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  // A conversation per entry; going back to an entry reopens its conversation.
  useEffect(() => {
    const previous = conversations.get(key);
    if (previous) void store.init().then(() => store.openSession(previous));
    else store.newSession();
    handled.current = new Set();
    setStale(false);
  }, [store, key]);

  useEffect(() => {
    store.setContext(describeEntry(props, name, title || undefined));
  });

  // Remember the conversation and refresh the form when the agent changed this entry.
  useEffect(() => {
    return store.subscribe(() => {
      const { sessionId, messages } = store.state;
      if (sessionId) conversations.set(key, sessionId);
      if (!changedEntry(messages, documentId, handled.current)) return;
      const { modified, refetch } = latest.current;
      if (modified || !refetch) setStale(true);
      else refetch();
    });
  }, [store, key, documentId]);

  const ask = (text: string) => {
    if (!text.trim()) return;
    setOpen(true);
    setDraft("");
    void store.send(text);
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={3} width="100%">
      <Typography variant="pi" textColor="neutral600">
        Ask about this {name}. Changes wait for your approval.
      </Typography>
      {/* No <form>: this panel sits inside the edit view's form, and a nested form's submit never reaches React, so the browser reloads the page. */}
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Textarea
          name="klymbak-prompt"
          aria-label={`Ask about this ${name}`}
          placeholder={`Ask about this ${name}…`}
          value={draft}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
          onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask(draft);
            }
          }}
        />
        <Button type="button" fullWidth startIcon={<Sparkle />} disabled={!draft.trim()} onClick={() => ask(draft)}>
          Ask
        </Button>
      </Flex>
      <Flex direction="column" alignItems="stretch" gap={1}>
        {QUICK_PROMPTS.map((prompt) => (
          <Button key={prompt} variant="tertiary" size="S" onClick={() => ask(prompt)}>
            {prompt}
          </Button>
        ))}
      </Flex>
      {store.state.sessionId && !open && (
        <Button variant="secondary" fullWidth onClick={() => setOpen(true)}>
          Show the conversation
        </Button>
      )}
      {stale && (
        <Box background="warning100" padding={3} hasRadius>
          <Typography variant="pi" textColor="warning700">
            The assistant changed this entry. Save or discard your edits, then reload to see its changes.
          </Typography>
        </Box>
      )}
      {open &&
        createPortal(
          <StrapiTheme>
            <div className="kl-root kl-widget kl-widget--right" data-kl-theme={theme}>
              <div className="kl-widget__panel" role="dialog" aria-label={`Assistant: ${name}`}>
                <AgentChat
                  store={store}
                  theme={theme}
                  title={title ? `${name}: ${title}` : name}
                  suggestions={QUICK_PROMPTS}
                  onAction={onAction}
                  headerEnd={
                    <button type="button" className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label="Close" onClick={() => setOpen(false)}>
                      <Cross width={14} height={14} aria-hidden />
                    </button>
                  }
                />
              </div>
            </div>
          </StrapiTheme>,
          document.body,
        )}
    </Flex>
  );
}

/** The edit view's "Assistant" side panel, for people allowed to use the assistant. */
export function EntryPanel(props: EditViewContext) {
  const { allowedActions, isLoading } = StrapiAdmin.useRBAC(PERMISSIONS);
  if (isLoading || !allowedActions.canUse) return null;
  return { title: "Assistant", content: <EntryAssistant {...props} /> };
}

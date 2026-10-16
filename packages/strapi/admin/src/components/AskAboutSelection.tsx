import { useEffect, useState } from "react";
import { Box } from "@strapi/design-system";
import { Sparkle } from "@strapi/icons";
import * as StrapiAdmin from "@strapi/strapi/admin";
import { AgentChat, createAgentClient, createAgentStore, type AgentStore } from "@klymbak/react";
import "@klymbak/react/style.css";
import { agentUrl, PERMISSIONS, useAdminFetch, useAgentActions } from "../agent";
import { StrapiTheme, useStrapiThemeMode } from "../theme";

/** What the Content Manager passes to list-view bulk actions. */
export interface ListViewContext {
  collectionType: string;
  documents: (Record<string, unknown> & { documentId?: string; locale?: string | null })[];
  model: string;
}

const SUGGESTIONS = ["Summarize these entries", "Which of these need work before they are published?", "What do these have in common?"];
const MAX_LISTED = 50;

const useDocumentLayout = ((StrapiAdmin as unknown as Record<string, unknown>).unstable_useDocumentLayout ?? (() => undefined)) as (
  model: string,
) => { list?: { settings?: { mainField?: string } } } | undefined;

function describeSelection({ documents, model }: ListViewContext, mainField: string | undefined): string {
  const listed = documents.slice(0, MAX_LISTED).map((doc) => {
    const title = mainField && typeof doc[mainField] === "string" ? ` "${doc[mainField]}"` : "";
    return `${doc.documentId}${title}${doc.locale ? ` (${doc.locale})` : ""}`;
  });
  const more = documents.length > MAX_LISTED ? ` and ${documents.length - MAX_LISTED} more` : "";
  return `The person selected ${documents.length} entries of ${model} in the Content Manager list: ${listed.join(", ")}${more}.`;
}

function SelectionChat(props: ListViewContext) {
  const fetch = useAdminFetch();
  const theme = useStrapiThemeMode();
  const onAction = useAgentActions();
  const mainField = useDocumentLayout(props.model)?.list?.settings?.mainField;
  const [store] = useState<AgentStore>(() => createAgentStore({ client: createAgentClient({ baseUrl: agentUrl(), fetch }) }));

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  const count = props.documents.length;
  return (
    <Box height="min(640px, 70vh)" width="100%">
      <StrapiTheme className="kl-strapi-modal">
        <style>{`.kl-strapi-modal { height: 100%; }`}</style>
        <AgentChat
          store={store}
          theme={theme}
          showHeader={false}
          context={describeSelection(props, mainField)}
          suggestions={SUGGESTIONS}
          placeholder={`Ask about the ${count} selected ${count === 1 ? "entry" : "entries"}…`}
          onAction={onAction}
        />
      </StrapiTheme>
    </Box>
  );
}

/** The list view's "Ask the assistant" bulk action. */
export function AskAboutSelection(props: ListViewContext) {
  const { allowedActions, isLoading } = StrapiAdmin.useRBAC(PERMISSIONS);
  if (isLoading || !allowedActions.canUse || !props.documents.length) return null;
  const count = props.documents.length;
  return {
    label: "Ask the assistant",
    variant: "secondary" as const,
    icon: <Sparkle />,
    dialog: {
      type: "modal" as const,
      title: `Ask about ${count} selected ${count === 1 ? "entry" : "entries"}`,
      content: <SelectionChat {...props} />,
    },
  };
}

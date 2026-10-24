import { useEffect, useState, useSyncExternalStore } from "react";
import { Box } from "@strapi/design-system";
import { Sparkle } from "@strapi/icons";
import * as StrapiAdmin from "@strapi/strapi/admin";
import { AgentChat, createAgentClient, createAgentStore, type AgentStore } from "@klymbak/react";
import { agentUrl, PERMISSIONS, useAdminFetch, useAgentActions } from "../agent";
import { useAgentI18n, useAppTexts, useT } from "../i18n";
import { StrapiTheme, useStrapiThemeMode } from "../theme";

/** What the Content Manager passes to list-view bulk actions. */
export interface ListViewContext {
  collectionType: string;
  documents: (Record<string, unknown> & { documentId?: string; locale?: string | null })[];
  model: string;
}

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
  const t = useT();
  const { locale, messages } = useAgentI18n();
  const mainField = useDocumentLayout(props.model)?.list?.settings?.mainField;
  const [store] = useState<AgentStore>(() => createAgentStore({ client: createAgentClient({ baseUrl: agentUrl(), fetch }) }));
  useSyncExternalStore(store.subscribe, store.getVersion);
  const { title, description } = useAppTexts(store.state.config?.app);

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  return (
    <Box height="min(640px, 70vh)" width="100%">
      <StrapiTheme className="kl-strapi-modal">
        <style>{`.kl-strapi-modal { height: 100%; }`}</style>
        <AgentChat
          store={store}
          theme={theme}
          locale={locale}
          messages={messages}
          showHeader={false}
          context={describeSelection(props, mainField)}
          title={title}
          description={description}
          suggestions={[t("selection.prompt.summarize"), t("selection.prompt.review"), t("selection.prompt.common")]}
          placeholder={t("selection.placeholder", { count: props.documents.length })}
          onAction={onAction}
        />
      </StrapiTheme>
    </Box>
  );
}

/** The list view's "Ask the assistant" bulk action. */
export function AskAboutSelection(props: ListViewContext) {
  const { allowedActions, isLoading } = StrapiAdmin.useRBAC(PERMISSIONS);
  const t = useT();
  if (isLoading || !allowedActions.canUse || !props.documents.length) return null;
  return {
    label: t("selection.action"),
    variant: "secondary" as const,
    icon: <Sparkle />,
    dialog: {
      type: "modal" as const,
      title: t("selection.title", { count: props.documents.length }),
      content: <SelectionChat {...props} />,
    },
  };
}

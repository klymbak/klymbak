import { useEffect, useState, useSyncExternalStore } from "react";
import { Page } from "@strapi/strapi/admin";
import { AgentWorkspace, createAgentClient, createAgentStore, type AgentStore } from "@klymbak/react";
import "@klymbak/react/style.css";
import { agentUrl, PERMISSIONS, useAdminFetch, useAgentActions } from "../agent";
import { useAgentI18n, useAppTexts, useT } from "../i18n";
import { StrapiTheme, useStrapiThemeMode } from "../theme";

/** The full-page assistant: conversations, schedules and tools beside the chat. */
function Assistant() {
  const fetch = useAdminFetch();
  const theme = useStrapiThemeMode();
  const onAction = useAgentActions();
  const { locale, messages } = useAgentI18n();
  const [store] = useState<AgentStore>(() => createAgentStore({ client: createAgentClient({ baseUrl: agentUrl(), fetch }) }));
  useSyncExternalStore(store.subscribe, store.getVersion);
  const app = useAppTexts(store.state.config?.app);

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  return (
    <StrapiTheme className="kl-strapi-page">
      <style>{`.kl-strapi-page { height: 100vh; height: 100dvh; }`}</style>
      <AgentWorkspace store={store} theme={theme} locale={locale} messages={messages} onAction={onAction} {...app} />
    </StrapiTheme>
  );
}

export default function AssistantPage() {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.use}>
      <Page.Title>{t("plugin.name")}</Page.Title>
      <Assistant />
    </Page.Protect>
  );
}

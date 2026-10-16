import { Page } from "@strapi/strapi/admin";
import { AgentWorkspace } from "@klymbak/react";
import "@klymbak/react/style.css";
import { agentUrl, PERMISSIONS, useAdminFetch, useAgentActions } from "../agent";
import { StrapiTheme, useStrapiThemeMode } from "../theme";

/** The full-page assistant: conversations, schedules and tools beside the chat. */
function Assistant() {
  const fetch = useAdminFetch();
  const theme = useStrapiThemeMode();
  const onAction = useAgentActions();
  return (
    <StrapiTheme className="kl-strapi-page">
      <style>{`.kl-strapi-page { height: 100vh; height: 100dvh; }`}</style>
      <AgentWorkspace baseUrl={agentUrl()} fetch={fetch} theme={theme} onAction={onAction} />
    </StrapiTheme>
  );
}

export default function AssistantPage() {
  return (
    <Page.Protect permissions={PERMISSIONS.use}>
      <Page.Title>Assistant</Page.Title>
      <Assistant />
    </Page.Protect>
  );
}

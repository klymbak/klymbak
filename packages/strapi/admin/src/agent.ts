import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as StrapiAdmin from "@strapi/strapi/admin";
import type { UiAction } from "@klymbak/react";

export const PLUGIN_ID = "klymbak";
export const PERMISSIONS = { use: [{ action: `plugin::${PLUGIN_ID}.use`, subject: null }] };
/** Matches OPEN_ENTRY_EVENT on the server: "Open" buttons on entries the agent shows. */
const OPEN_ENTRY_EVENT = "strapi.open_entry";

/** The agent's API, served by the plugin's admin routes. */
export function agentUrl(): string {
  const backend = (window as { strapi?: { backendURL?: string } }).strapi?.backendURL ?? "";
  return `${backend.replace(/\/+$/, "")}/${PLUGIN_ID}/agent`;
}

type Refresh = (tokenUsedByFailedRequest?: string | null) => Promise<string | null>;

/**
 * fetch with the signed-in admin's access token. Strapi's tokens are short-lived, so a 401 asks
 * the admin to refresh it (as its own requests do) and the request is sent once more.
 */
export function useAdminFetch(): typeof fetch {
  const token = StrapiAdmin.useAuth("Klymbak", (auth) => auth.token);
  const current = useRef(token);
  current.current = token;

  return useMemo<typeof fetch>(() => {
    const refresh = (StrapiAdmin as unknown as { attemptTokenRefresh?: Refresh }).attemptTokenRefresh;
    const send = (input: RequestInfo | URL, init: RequestInit | undefined, token: string | null) => {
      const headers = new Headers(init?.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    };
    return async (input, init) => {
      const response = await send(input, init, current.current);
      if (response.status !== 401 || !refresh) return response;
      try {
        const fresh = await refresh(current.current);
        if (!fresh) return response;
        current.current = fresh;
      } catch {
        return response;
      }
      return send(input, init, current.current);
    };
  }, []);
}

interface OpenEntryPayload {
  contentType: string;
  kind?: string;
  documentId?: string;
  locale?: string;
}

/** Handles UI actions from tool results: "Open" goes to the entry in the Content Manager. */
export function useAgentActions(onOther?: (action: UiAction) => void) {
  const navigate = useNavigate();
  return (action: UiAction) => {
    if (action.event !== OPEN_ENTRY_EVENT || !action.payload) return onOther?.(action);
    const entry = action.payload as OpenEntryPayload;
    const path =
      entry.kind === "singleType"
        ? `/content-manager/single-types/${entry.contentType}`
        : `/content-manager/collection-types/${entry.contentType}/${entry.documentId}`;
    navigate(entry.locale ? `${path}?plugins[i18n][locale]=${encodeURIComponent(entry.locale)}` : path);
  };
}

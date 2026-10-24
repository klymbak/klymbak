import { Sparkle } from "@strapi/icons";
import { PERMISSIONS, PLUGIN_ID } from "./agent";
import { AskAboutSelection } from "./components/AskAboutSelection";
import { EntryPanel } from "./components/EntryPanel";
import { translations } from "./i18n";

interface ContentManagerApis {
  addEditViewSidePanel(panels: unknown[]): void;
  addBulkAction(actions: unknown[]): void;
}

interface AdminApp {
  addMenuLink(link: object): void;
  registerPlugin(plugin: { id: string; name: string }): void;
  getPlugin(id: string): { apis: unknown } | undefined;
}

export default {
  register(app: AdminApp) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: Sparkle,
      intlLabel: { id: `${PLUGIN_ID}.plugin.name`, defaultMessage: "Assistant" },
      permissions: PERMISSIONS.use,
      Component: () => import("./pages/AssistantPage"),
    });
    app.registerPlugin({ id: PLUGIN_ID, name: PLUGIN_ID });
  },

  bootstrap(app: AdminApp) {
    const contentManager = app.getPlugin("content-manager")?.apis as ContentManagerApis | undefined;
    // Chat about the open entry from the edit view, and about selected entries from the list view.
    contentManager?.addEditViewSidePanel([EntryPanel]);
    contentManager?.addBulkAction([AskAboutSelection]);
  },

  async registerTrads({ locales }: { locales: string[] }) {
    return Promise.all(locales.map(async (locale) => ({ locale, data: await translations(locale) })));
  },
};

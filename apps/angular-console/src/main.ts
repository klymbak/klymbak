import { provideBrowserGlobalErrorListeners } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { configureFormatting, provideKlymbak } from "@klymbak/angular";
import { Playground } from "./playground.ts";

configureFormatting({ locale: "en-US" });

bootstrapApplication(Playground, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // The demo API fakes sign-in with a header (see apps/acme-api); a real app sends its session cookie.
    provideKlymbak({ baseUrl: "/api/agent", headers: { "x-demo-user": "admin" } }),
  ],
}).catch((error: unknown) => console.error(error));

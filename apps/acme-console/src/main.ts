import { createApp } from "vue";
import { configureFormatting } from "@klymbak/vue";
import "@klymbak/vue/style.css";
import "./theme.css";
import App from "./App.vue";

// Acme reports in USD for a US audience, whatever the viewer's browser locale.
configureFormatting({ locale: "en-US" });

createApp(App).mount("#app");

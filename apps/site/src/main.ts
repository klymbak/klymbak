import { createApp } from "vue";
import { configureFormatting } from "@klymbak/vue";
import "@klymbak/vue/style.css";
import "./site.css";
import App from "./App.vue";
import { locale } from "./content.ts";

configureFormatting({ locale: locale === "en" ? "en-US" : locale });
createApp(App).mount("#app");

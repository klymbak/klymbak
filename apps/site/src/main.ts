import { createApp } from "vue";
import { configureFormatting } from "@klymbak/vue";
import "@klymbak/vue/style.css";
import "./site.css";
import App from "./App.vue";

configureFormatting({ locale: "en-US" });
createApp(App).mount("#app");

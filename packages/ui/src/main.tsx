import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DesignApp } from "./design/design-app";
import { I18nProvider } from "./i18n";
import "./styles.css";

const RootApp = window.location.pathname.startsWith("/design") ? DesignApp : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <RootApp />
    </I18nProvider>
  </StrictMode>,
);

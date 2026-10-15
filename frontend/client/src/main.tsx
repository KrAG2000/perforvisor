import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@perforvisor/ui";
import "./fonts.ts";
import "@perforvisor/ui/base.css";
import "./theme.css";
import "./app.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="perforvisor-client-theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
);

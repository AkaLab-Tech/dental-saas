import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { i18nReady } from "./i18n";

// Gate first render on i18n readiness so the detected locale and
// document.dir/lang are settled before any component calls useTranslation().
i18nReady.then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});

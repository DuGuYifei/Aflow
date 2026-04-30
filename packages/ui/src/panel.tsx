import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkflowPanel } from "./index.js";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Specflow UI root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <WorkflowPanel />
  </StrictMode>
);

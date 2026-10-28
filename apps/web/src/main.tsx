import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { connect } from "./net/store";
import { App } from "./ui/App";
import "./styles.css";

connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

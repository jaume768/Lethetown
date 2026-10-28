import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { connect } from "./net/store";
import { App } from "./ui/App";
import { Overlay } from "./ui/Overlay";
import "./styles.css";

connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname.replace(/\/$/, "") === "/overlay" ? <Overlay /> : <App />}
  </StrictMode>,
);

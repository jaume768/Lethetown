import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { connect } from "./net/store";
import { App } from "./ui/App";
import { Overlay } from "./ui/Overlay";
import { ReplayApp } from "./ui/ReplayApp";
import "./styles.css";

const route = location.pathname.replace(/\/$/, "");
// La repetición no habla con el servidor: ni WebSocket ni API.
if (route !== "/replay") connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {route === "/overlay" ? <Overlay /> : route === "/replay" ? <ReplayApp /> : <App />}
  </StrictMode>,
);

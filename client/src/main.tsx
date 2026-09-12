import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import Presenter from "./Presenter";
import { isPresenterWindow } from "./desktop";

// The second window is the presenter's; it renders a different app entirely.
createRoot(document.getElementById("root")!).render(
  <StrictMode>{isPresenterWindow ? <Presenter /> : <App />}</StrictMode>,
);

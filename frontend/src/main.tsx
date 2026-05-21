import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import VerifyEmail from "./components/VerifyEmail";
import ResetPassword from "./components/ResetPassword";
import "./styles.css";

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";

const path = window.location.pathname;
const route = path === "/verify-email" ? "verify"
  : path === "/reset-password" ? "reset"
  : "app";

const tree = (
  <>
    {route === "verify" ? <VerifyEmail /> : route === "reset" ? <ResetPassword /> : <App />}
  </>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {GOOGLE_CLIENT_ID ? (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{tree}</GoogleOAuthProvider>
    ) : tree}
  </React.StrictMode>,
);

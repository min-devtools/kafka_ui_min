import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { initPersistence } from "./lib/persist";
import "./lib/monaco";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/views.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

void initPersistence();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

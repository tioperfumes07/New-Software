import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { installStaleChunkRecovery } from "./bootstrap/installStaleChunkRecovery";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StaleDeployBanner } from "./components/StaleDeployBanner";
import { ToastProvider } from "./components/Toast";
import { initFrontendSentry } from "./observability/sentry-client";
import "./index.css";
import "./styles/tokens-load-detail.css";
import i18n from "./i18n";

void i18n;

installStaleChunkRecovery();

// G10-C3: actually initialize Sentry (the init fn existed but was never called). No-ops when
// VITE_SENTRY_DSN is unset, so local/dev is unaffected.
void initFrontendSentry();

// GO-LIVE #15 (429): without defaults, every component mount + window-focus refetched, so the same
// provider GETs (sync-health, qbo, preferences, notifications, identity/me) fired many times per load
// and overran the edge per-IP rate limit — a following status-change WRITE then tipped to 429. Sane
// defaults (cache + dedupe identical keys, no refetch-on-focus) cut the volume so writes stay under it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <StaleDeployBanner />
        {/*
          React Router 7 defaults BrowserRouter history updates to startTransition.
          A pending route render can therefore retain the previous committed screen even
          after pushState changes the URL. Route navigation is an immediate product action;
          commit the location synchronously so the keyed route Suspense boundary can mount.
        */}
        <BrowserRouter useTransitions={false}>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)

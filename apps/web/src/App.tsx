import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import { useState } from "react";
import "./i18n.ts";
import { type Platform, PlatformProvider, webPlatform } from "./platform.tsx";
import { createAppRouter } from "./router.tsx";

export interface AppProps {
  // The device: the browser by default; tests and the native wrap pass their own.
  platform?: Platform;
  // The browser's history by default; tests pass a memory history.
  history?: RouterHistory;
}

export function App({ platform = webPlatform, history }: AppProps) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const [router] = useState(() => createAppRouter(history));

  return (
    <PlatformProvider value={platform}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PlatformProvider>
  );
}

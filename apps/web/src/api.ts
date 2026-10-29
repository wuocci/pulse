import { createClient } from "@pulse/client";
import { useQuery } from "@tanstack/react-query";

// The API's origin. In development it's the Vite dev server, which proxies /v0; a wrapped native app sets
// VITE_API_URL, since it isn't served from the API's origin.
// fetch is looked up per request, not captured once here, so whatever is installed when a request runs (a test's
// mock server, a native HTTP layer) is used.
const client = createClient({
  baseUrl: import.meta.env.VITE_API_URL || window.location.origin,
  fetch: (request) => fetch(request),
});

export function useRegions() {
  return useQuery({
    queryKey: ["regions"],
    queryFn: async () => {
      const { data, response } = await client.GET("/regions");
      if (!data) throw new Error(`GET /regions responded ${response.status}`);
      return data.regions;
    },
    // Regions are configuration: they don't change while the app is open.
    staleTime: Infinity,
  });
}

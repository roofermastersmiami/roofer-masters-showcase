import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installModuleLoadRecovery } from "@/lib/module-load-recovery";

const recoveryWindows = new WeakSet<Window>();

export const getRouter = () => {
  // Install before route loading; the root component may never mount on an import failure.
  if (typeof window !== "undefined" && !recoveryWindows.has(window)) {
    installModuleLoadRecovery(window);
    recoveryWindows.add(window);
  }
  // One client per request: a module-level QueryClient leaks cached data between SSR requests.
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Lets Query own freshness; set caching defaults on the QueryClient, not the router.
    defaultPreloadStaleTime: 0,
  });

  return router;
};

import { useCallback, useEffect, useRef } from "react";
import { ServiceProvider } from "./app/ServiceProvider";
import type { CoordinatorSessionHandle } from "./app/coordinatorClient";
import { useServices } from "./app/serviceContext";
import type { AppBridge } from "./bridges/app/types";
import { diagnosticLogger } from "./diagnostics/diagnosticLogger";
import type { CopyStatus as BookshelfCopyStatus } from "./features/bookshelf/BookshelfHeader";
import { BookshelfPage } from "./features/bookshelf/BookshelfPage";
import { ReaderPage } from "./features/reader/ReaderPage";
import { RouterProvider } from "./shared/router/RouterProvider";
import { useRouter } from "./shared/router/routerContext";

export type CopyStatus = BookshelfCopyStatus;

export interface AppProps {
  readonly initialPath?: string;
  readonly appBridge?: AppBridge;
  readonly createCoordinatorSession?: () => CoordinatorSessionHandle;
  readonly initialCopyStatus?: CopyStatus;
}

interface AppShellProps {
  readonly initialCopyStatus: CopyStatus;
}

function AppShell({ initialCopyStatus }: AppShellProps) {
  const { appBridge } = useServices();
  const { route } = useRouter();
  const readerExitRef = useRef<(() => void) | null>(null);
  const routeNameRef = useRef(route.name);
  routeNameRef.current = route.name;

  useEffect(() => {
    diagnosticLogger.info("app", "ExLibris shell initialized");
  }, []);

  useEffect(() => {
    return appBridge.addBackButtonListener(() => {
      if (routeNameRef.current === "reader-local") {
        readerExitRef.current?.();
        return;
      }
      void appBridge.minimizeApp().catch(() => {});
    });
  }, [appBridge]);

  const handleRegisterReaderExit = useCallback(
    (exitFn: (() => void) | null) => {
      readerExitRef.current = exitFn;
    },
    [],
  );

  return (
    <div
      data-testid="app-root"
      data-app-ready="true"
      className="min-h-screen bg-slate-950 text-slate-100"
    >
      {route.name === "reader-local" ? (
        <ReaderPage onRegisterExit={handleRegisterReaderExit} />
      ) : (
        <BookshelfPage initialCopyStatus={initialCopyStatus} />
      )}
    </div>
  );
}

export function App({
  initialPath,
  appBridge,
  createCoordinatorSession,
  initialCopyStatus = "idle",
}: AppProps) {
  return (
    <ServiceProvider
      appBridge={appBridge}
      createCoordinatorSession={createCoordinatorSession}
    >
      <RouterProvider initialPath={initialPath}>
        <AppShell initialCopyStatus={initialCopyStatus} />
      </RouterProvider>
    </ServiceProvider>
  );
}

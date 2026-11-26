import { useCallback, useEffect, useRef } from "react";
import { ServiceProvider } from "./app/ServiceProvider";
import type { CoordinatorSessionHandle } from "./app/coordinatorClient";
import { useServices } from "./app/serviceContext";
import type { AppBridge } from "./bridges/app/types";
import { diagnosticLogger } from "./diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "./diagnostics/types";
import type { CopyStatus as BookshelfCopyStatus } from "./features/bookshelf/BookshelfHeader";
import {
  BookshelfPage,
  type BookshelfPageInitialSnapshot,
} from "./features/bookshelf/BookshelfPage";
import type { DriveSetupBannerState } from "./features/bookshelf/DriveSetupBanner";
import { ReaderPage } from "./features/reader/ReaderPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import type { SettingsPageInitialSnapshot } from "./features/settings/types";
import { RouterProvider } from "./shared/router/RouterProvider";
import { useRouter } from "./shared/router/routerContext";

export type CopyStatus = BookshelfCopyStatus;

export interface AppProps {
  readonly initialPath?: string;
  readonly appBridge?: AppBridge;
  readonly createCoordinatorSession?: () => CoordinatorSessionHandle;
  readonly initialCopyStatus?: CopyStatus;
  readonly initialDriveSetupState?: DriveSetupBannerState;
  readonly initialBookshelfSnapshot?: BookshelfPageInitialSnapshot;
  readonly initialSettingsSnapshot?: SettingsPageInitialSnapshot;
  readonly settingsLogger?: DiagnosticLogger;
}

interface AppShellProps {
  readonly initialCopyStatus: CopyStatus;
  readonly initialDriveSetupState?: DriveSetupBannerState;
  readonly initialSettingsSnapshot?: SettingsPageInitialSnapshot;
  readonly settingsLogger?: DiagnosticLogger;
}

function AppShell({
  initialCopyStatus,
  initialDriveSetupState,
  initialSettingsSnapshot,
  settingsLogger,
}: AppShellProps) {
  const { appBridge } = useServices();
  const { route, back, isBackBlocked } = useRouter();
  const readerExitRef = useRef<(() => void) | null>(null);
  const settingsModalBackRef = useRef<(() => void) | null>(null);
  const routeNameRef = useRef(route.name);
  routeNameRef.current = route.name;
  const isBackBlockedRef = useRef(isBackBlocked);
  isBackBlockedRef.current = isBackBlocked;
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    diagnosticLogger.info("app", "ExLibris shell initialized");
  }, []);

  useEffect(() => {
    return appBridge.addBackButtonListener(() => {
      if (isBackBlockedRef.current) {
        return;
      }
      if (routeNameRef.current === "settings" && settingsModalBackRef.current) {
        settingsModalBackRef.current();
        return;
      }
      if (routeNameRef.current === "reader-local") {
        readerExitRef.current?.();
        return;
      }
      if (routeNameRef.current === "settings") {
        backRef.current();
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

  const handleRegisterSettingsModalBack = useCallback(
    (closeModalFn: (() => void) | null) => {
      settingsModalBackRef.current = closeModalFn;
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
      ) : route.name === "settings" ? (
        <SettingsPage
          onRegisterModalBack={handleRegisterSettingsModalBack}
          {...(initialSettingsSnapshot !== undefined
            ? { initialSnapshot: initialSettingsSnapshot }
            : {})}
          {...(settingsLogger !== undefined ? { logger: settingsLogger } : {})}
        />
      ) : (
        <BookshelfPage
          initialCopyStatus={initialCopyStatus}
          {...(initialDriveSetupState !== undefined
            ? { initialDriveSetupState }
            : {})}
        />
      )}
    </div>
  );
}

export function App({
  initialPath,
  appBridge,
  createCoordinatorSession,
  initialCopyStatus = "idle",
  initialDriveSetupState,
  initialSettingsSnapshot,
  settingsLogger,
}: AppProps) {
  return (
    <ServiceProvider
      appBridge={appBridge}
      createCoordinatorSession={createCoordinatorSession}
    >
      <RouterProvider initialPath={initialPath}>
        <AppShell
          initialCopyStatus={initialCopyStatus}
          initialDriveSetupState={initialDriveSetupState}
          initialSettingsSnapshot={initialSettingsSnapshot}
          settingsLogger={settingsLogger}
        />
      </RouterProvider>
    </ServiceProvider>
  );
}

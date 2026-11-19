import type { CoordinatorSessionHandle } from "./app/coordinatorClient";
import type { AppBridge } from "./bridges/app/types";
import type { CopyStatus as BookshelfCopyStatus } from "./features/bookshelf/BookshelfHeader";

export type CopyStatus = BookshelfCopyStatus;

export interface AppProps {
  readonly initialPath?: string;
  readonly appBridge?: AppBridge;
  readonly createCoordinatorSession?: () => CoordinatorSessionHandle;
  readonly initialCopyStatus?: CopyStatus;
}

export function App(_props: AppProps) {
  return <div data-testid="app-root" data-app-ready="false" />;
}

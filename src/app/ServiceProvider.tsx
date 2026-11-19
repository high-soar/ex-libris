import type { ReactNode } from "react";
import type { AppBridge } from "../bridges/app/types";
import type { CoordinatorSessionHandle } from "./coordinatorClient";

export interface ServiceProviderProps {
  readonly children?: ReactNode;
  readonly appBridge?: AppBridge;
  readonly createCoordinatorSession?: () => CoordinatorSessionHandle;
}

export function ServiceProvider({ children }: ServiceProviderProps) {
  return <>{children}</>;
}

import type { ReactNode } from "react";
import type { DiagnosticEntry } from "../../diagnostics/types";
import type { DiagnosticsCopyStatus } from "./types";

export interface DiagnosticsSectionProps {
  readonly entries: readonly DiagnosticEntry[];
  readonly copyStatus: DiagnosticsCopyStatus;
  readonly onCopyDiagnostics: () => void;
  readonly onClearDiagnostics: () => void;
}

export function DiagnosticsSection({
  entries: _entries,
  copyStatus: _copyStatus,
  onCopyDiagnostics: _onCopyDiagnostics,
  onClearDiagnostics: _onClearDiagnostics,
}: DiagnosticsSectionProps): ReactNode {
  return <section />;
}

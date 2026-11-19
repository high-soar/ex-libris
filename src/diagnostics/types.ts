export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEntry {
  id: number;
  timestamp: string;
  level: DiagnosticLevel;
  scope: string;
  message: string;
  detail?: string;
}

export interface DiagnosticLogger {
  log: (
    level: DiagnosticLevel,
    scope: string,
    message: string,
    detail?: string,
  ) => DiagnosticEntry;
  info: (scope: string, message: string, detail?: string) => DiagnosticEntry;
  warn: (scope: string, message: string, detail?: string) => DiagnosticEntry;
  error: (scope: string, message: string, detail?: string) => DiagnosticEntry;
  getEntries: () => DiagnosticEntry[];
  clear: () => void;
  formatReport: (now?: Date) => string;
}

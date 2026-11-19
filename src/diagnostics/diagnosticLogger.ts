import { APP_NAME, APP_VERSION } from "../shared/constants/app";
import type {
  DiagnosticEntry,
  DiagnosticLevel,
  DiagnosticLogger,
} from "./types";

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const QUERY_SECRET_PATTERN =
  /\b(access_token|refresh_token|id_token|api_key|apikey|client_secret|password|secret|token|key)=([^\s&"'`,;]+)/gi;
const JSON_SECRET_PATTERN =
  /"(access_token|refresh_token|id_token|api_key|apikey|client_secret|password|secret|token|key)"\s*:\s*"([^"]+)"/gi;

export function redactSensitiveText(input: string): string {
  return input
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(QUERY_SECRET_PATTERN, "$1=[REDACTED]")
    .replace(JSON_SECRET_PATTERN, '"$1":"[REDACTED]"');
}

export function createDiagnosticLogger(maxEntries = 200): DiagnosticLogger {
  const capacity = Math.max(1, maxEntries);
  const entries: DiagnosticEntry[] = [];
  let sequence = 0;

  const log = (
    level: DiagnosticLevel,
    scope: string,
    message: string,
    detail?: string,
  ): DiagnosticEntry => {
    sequence += 1;
    const entry: DiagnosticEntry = {
      id: sequence,
      timestamp: new Date().toISOString(),
      level,
      scope: redactSensitiveText(scope),
      message: redactSensitiveText(message),
      ...(detail !== undefined ? { detail: redactSensitiveText(detail) } : {}),
    };

    entries.push(entry);
    if (entries.length > capacity) {
      entries.shift();
    }
    return entry;
  };

  return {
    log,
    info: (scope, message, detail) => log("info", scope, message, detail),
    warn: (scope, message, detail) => log("warn", scope, message, detail),
    error: (scope, message, detail) => log("error", scope, message, detail),
    getEntries: () => [...entries],
    clear: () => {
      entries.length = 0;
    },
    formatReport: (now = new Date()) => {
      const header = [
        `# ${APP_NAME} Diagnostic Report`,
        `version: v${APP_VERSION}`,
        `generatedAt: ${now.toISOString()}`,
        `entries: ${entries.length}`,
      ];

      if (entries.length === 0) {
        return [...header, "(no diagnostic entries)"].join("\n");
      }

      const lines = entries.map((entry) => {
        const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`;
        return entry.detail !== undefined ? `${base} | ${entry.detail}` : base;
      });

      return [...header, ...lines].join("\n");
    },
  };
}

export const diagnosticLogger = createDiagnosticLogger();

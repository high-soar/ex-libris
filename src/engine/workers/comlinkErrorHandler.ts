import * as Comlink from "comlink";
import type { ZipErrorCode } from "../types";
import { ZipArchiveError } from "../zip/errors";

export type ComlinkTransferHandlers = Map<
  string,
  Comlink.TransferHandler<unknown, unknown>
>;

interface SerializedErrorEnvelope {
  readonly isError: true;
  readonly value: Record<string, unknown>;
}

interface SerializedZipArchiveErrorEnvelope {
  readonly isError: true;
  readonly value: {
    readonly name: "ZipArchiveError";
    readonly message: string;
    readonly stack?: unknown;
    readonly code: ZipErrorCode;
  };
}

const ZIP_ERROR_CODE_MAP: Record<ZipErrorCode, true> = {
  CORRUPT_ZIP: true,
  EMPTY_ARCHIVE: true,
  ENCRYPTED_ZIP: true,
  UNSUPPORTED_COMPRESSION: true,
  DECODE_FAILED: true,
  READ_ERROR: true,
};

const ZIP_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.keys(ZIP_ERROR_CODE_MAP),
);

const wrappedThrowHandlers = new WeakSet<
  Comlink.TransferHandler<unknown, unknown>
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isZipErrorCode(value: unknown): value is ZipErrorCode {
  return typeof value === "string" && ZIP_ERROR_CODES.has(value);
}

function isSerializedErrorEnvelope(
  value: unknown,
): value is SerializedErrorEnvelope {
  return isRecord(value) && value.isError === true && isRecord(value.value);
}

function isSerializedZipArchiveError(
  value: unknown,
): value is SerializedZipArchiveErrorEnvelope {
  if (!isSerializedErrorEnvelope(value)) {
    return false;
  }
  const { name, message, code } = value.value;
  return (
    name === "ZipArchiveError" &&
    typeof message === "string" &&
    isZipErrorCode(code)
  );
}

export function registerZipArchiveErrorTransferHandler(
  handlers: ComlinkTransferHandlers = Comlink.transferHandlers,
): void {
  const baseHandler = handlers.get("throw");
  if (!baseHandler || wrappedThrowHandlers.has(baseHandler)) {
    return;
  }

  const wrappedHandler: Comlink.TransferHandler<unknown, unknown> = {
    canHandle(value): value is unknown {
      return baseHandler.canHandle(value);
    },
    serialize(rawValue) {
      const thrownValue = isRecord(rawValue) ? rawValue.value : undefined;
      const [serialized, transferables] = baseHandler.serialize(rawValue);
      if (
        isSerializedErrorEnvelope(serialized) &&
        thrownValue instanceof ZipArchiveError
      ) {
        return [
          {
            isError: true,
            value: {
              ...serialized.value,
              code: thrownValue.code,
            },
          },
          transferables,
        ];
      }
      if (thrownValue instanceof DOMException) {
        return [
          {
            isError: true,
            value: {
              message: thrownValue.message,
              name: thrownValue.name,
              stack: thrownValue.stack,
            },
          },
          transferables,
        ];
      }
      return [serialized, transferables];
    },
    deserialize(serialized) {
      if (isSerializedZipArchiveError(serialized)) {
        const { code, message, stack } = serialized.value;
        const error = new ZipArchiveError(code, message);
        if (typeof stack === "string") {
          error.stack = stack;
        }
        throw error;
      }
      return baseHandler.deserialize(serialized);
    },
  };

  wrappedThrowHandlers.add(wrappedHandler);
  handlers.set("throw", wrappedHandler);
}

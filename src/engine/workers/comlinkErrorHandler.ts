import * as Comlink from "comlink";

export type ComlinkTransferHandlers = Map<
  string,
  Comlink.TransferHandler<unknown, unknown>
>;

export function registerZipArchiveErrorTransferHandler(
  handlers: ComlinkTransferHandlers = Comlink.transferHandlers,
): void {
  void handlers;
}

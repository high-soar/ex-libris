import type { DecodeWorkerApi, ZipCompressionMethod } from "../types";
import {
  decompressZipSlice,
  type DecompressZipSliceDeps,
} from "../zip/decompressSlice";
import { ZipArchiveError } from "../zip/errors";

export interface DecodeWorkerDeps extends DecompressZipSliceDeps {
  readonly createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
}

export class DecodeWorkerCore implements DecodeWorkerApi {
  private readonly decodeBitmap: (blob: Blob) => Promise<ImageBitmap>;
  private readonly decompressDeps: DecompressZipSliceDeps;

  constructor(deps: DecodeWorkerDeps = {}) {
    this.decodeBitmap =
      deps.createImageBitmap ?? ((blob) => createImageBitmap(blob));
    this.decompressDeps = {
      createDecompressionStream: deps.createDecompressionStream,
    };
  }

  async decodePageSlice(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
  ): Promise<{
    bitmap: ImageBitmap;
    width: number;
    height: number;
  }> {
    try {
      const rawBytes = await decompressZipSlice(
        compressedData,
        compressionMethod,
        this.decompressDeps,
      );
      const blob = new Blob([rawBytes as Uint8Array<ArrayBuffer>]);
      const bitmap = await this.decodeBitmap(blob);

      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
      };
    } catch (error) {
      throw new ZipArchiveError(
        "DECODE_FAILED",
        "画像ページの伸長またはデコードに失敗しました",
        error,
      );
    }
  }
}

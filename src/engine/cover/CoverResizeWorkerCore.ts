import { ENGINE_BUDGETS } from "../constants";
import type { ZipCompressionMethod } from "../types";
import {
  computeMaxDecompressedBytes,
  decompressZipSlice,
  type DecompressZipSliceDeps,
} from "../zip/decompressSlice";
import { ZipArchiveError } from "../zip/errors";
import type {
  CoverResizeWorkerApi,
  EncodeCoverWebpOptions,
  EncodeCoverWebpResult,
} from "./types";

export interface CoverCanvas2DContextLike {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  drawImage(
    image: ImageBitmap,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export interface CoverOffscreenCanvasLike {
  getContext(contextId: "2d"): CoverCanvas2DContextLike | null;
  convertToBlob(options?: ImageEncodeOptions): Promise<Blob>;
}

export interface CoverResizeWorkerDeps extends DecompressZipSliceDeps {
  readonly createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  readonly createOffscreenCanvas?: (
    width: number,
    height: number,
  ) => CoverOffscreenCanvasLike;
}

export class CoverResizeWorkerCore implements CoverResizeWorkerApi {
  private readonly decodeBitmap: (blob: Blob) => Promise<ImageBitmap>;
  private readonly createOffscreenCanvas: (
    width: number,
    height: number,
  ) => CoverOffscreenCanvasLike;
  private readonly decompressDeps: DecompressZipSliceDeps;

  constructor(deps: CoverResizeWorkerDeps = {}) {
    this.decodeBitmap =
      deps.createImageBitmap ?? ((blob) => createImageBitmap(blob));
    this.createOffscreenCanvas =
      deps.createOffscreenCanvas ??
      ((width, height) => new OffscreenCanvas(width, height));
    this.decompressDeps = {
      createDecompressionStream: deps.createDecompressionStream,
    };
  }

  async encodeCoverWebp(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
    options?: EncodeCoverWebpOptions,
  ): Promise<EncodeCoverWebpResult> {
    try {
      const rawBytes = await decompressZipSlice(
        compressedData,
        compressionMethod,
        {
          ...this.decompressDeps,
          maxUncompressedBytes: computeMaxDecompressedBytes(
            options?.expectedUncompressedSize,
          ),
        },
      );
      const sourceBlob = new Blob([rawBytes as Uint8Array<ArrayBuffer>]);
      const bitmap = await this.decodeBitmap(sourceBlob);

      try {
        if (
          !Number.isFinite(bitmap.width) ||
          !Number.isFinite(bitmap.height) ||
          bitmap.width <= 0 ||
          bitmap.height <= 0
        ) {
          throw new ZipArchiveError(
            "DECODE_FAILED",
            `不正な表紙画像サイズです: width=${bitmap.width}, height=${bitmap.height}`,
          );
        }

        const maxLongEdge =
          options?.maxLongEdgePx ?? ENGINE_BUDGETS.COVER_MAX_LONG_EDGE_PX;
        const longEdge = Math.max(bitmap.width, bitmap.height);
        const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
        const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
        const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

        const canvas = this.createOffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
          throw new ZipArchiveError(
            "DECODE_FAILED",
            "表紙縮小用2Dコンテキストの取得に失敗しました",
          );
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

        const webpQuality =
          options?.webpQuality ?? ENGINE_BUDGETS.COVER_WEBP_QUALITY;
        const webpBlob = await canvas.convertToBlob({
          type: "image/webp",
          quality: webpQuality,
        });
        if (webpBlob.size <= 0) {
          throw new ZipArchiveError(
            "DECODE_FAILED",
            "空の表紙WebPが生成されました",
          );
        }

        return {
          blob: webpBlob,
          width: targetWidth,
          height: targetHeight,
        };
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (error instanceof ZipArchiveError) {
        throw error;
      }
      throw new ZipArchiveError(
        "DECODE_FAILED",
        "表紙画像の伸長またはWebP縮小変換に失敗しました",
        error,
      );
    }
  }
}

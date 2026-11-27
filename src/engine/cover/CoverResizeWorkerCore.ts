import type { ZipCompressionMethod } from "../types";
import type { DecompressZipSliceDeps } from "../zip/decompressSlice";
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
  constructor(_deps: CoverResizeWorkerDeps = {}) {
    void _deps;
  }

  async encodeCoverWebp(
    _compressedData: Uint8Array,
    _compressionMethod: ZipCompressionMethod,
    _options?: EncodeCoverWebpOptions,
  ): Promise<EncodeCoverWebpResult> {
    void _compressedData;
    void _compressionMethod;
    void _options;
    throw new Error("Not implemented");
  }
}

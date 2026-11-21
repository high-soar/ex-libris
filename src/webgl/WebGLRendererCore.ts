import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DecodedPageFrame } from "../engine/types";
import type { ReadyPageFrame } from "./l1PageCache";
import { FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE } from "./shaders";
import type { RenderSlotFrame, ViewportSlot } from "./types";

export type BitmapCropper = (
  bitmap: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
) => Promise<ImageBitmap>;

export type BitmapResizer = (
  bitmap: ImageBitmap,
  resizeWidth: number,
  resizeHeight: number,
) => Promise<ImageBitmap>;

export interface WebGLRendererCoreOptions {
  readonly onAsyncTextureReady?: (pageIndex: number) => void;
  readonly bitmapCropper?: BitmapCropper;
  readonly bitmapResizer?: BitmapResizer;
}

export class WebGLInitError extends Error {
  readonly code = "WEBGL_INIT_FAILED" as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "WebGLInitError";
  }
}

export interface ViewportDimensions {
  readonly width: number;
  readonly height: number;
}

interface WebGLPipeline {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly vbo: WebGLBuffer;
  readonly scaleLoc: WebGLUniformLocation;
  readonly offsetLoc: WebGLUniformLocation;
  readonly textureLoc: WebGLUniformLocation;
}

interface TileTexture {
  readonly texture: WebGLTexture;
  readonly xFrac: number;
  readonly yFrac: number;
  readonly wFrac: number;
  readonly hFrac: number;
}

interface TextureEntry {
  readonly bitmap: ImageBitmap;
  readonly tiles: readonly TileTexture[];
}

interface NdcRect {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

interface SlotDrawJob {
  readonly slot: ViewportSlot;
  readonly frame: ReadyPageFrame;
  readonly rect: NdcRect;
}

const DEFAULT_MAX_TEXTURE_SIZE = 4096;
const MAX_SPLIT_TILES = 16;

const QUAD_VERTICES = new Float32Array([
  -1, 1, 0, 0, -1, -1, 0, 1, 1, 1, 1, 0, 1, -1, 1, 1,
]);

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizeMaxTextureSize(rawValue: unknown): number {
  if (
    typeof rawValue === "number" &&
    Number.isFinite(rawValue) &&
    rawValue >= 1
  ) {
    return Math.floor(rawValue);
  }
  return DEFAULT_MAX_TEXTURE_SIZE;
}

function computeResizedDimensions(
  width: number,
  height: number,
  maxTextureSize: number,
): { readonly resizeWidth: number; readonly resizeHeight: number } {
  const scale = Math.min(maxTextureSize / width, maxTextureSize / height);
  return {
    resizeWidth: Math.max(
      1,
      Math.min(maxTextureSize, Math.floor(width * scale)),
    ),
    resizeHeight: Math.max(
      1,
      Math.min(maxTextureSize, Math.floor(height * scale)),
    ),
  };
}

function isReadyFrame(frame: DecodedPageFrame | null): frame is ReadyPageFrame {
  return frame !== null && frame.status === "ready";
}

function defaultBitmapCropper(
  bitmap: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Promise<ImageBitmap> {
  return createImageBitmap(bitmap, sx, sy, sw, sh);
}

function defaultBitmapResizer(
  bitmap: ImageBitmap,
  resizeWidth: number,
  resizeHeight: number,
): Promise<ImageBitmap> {
  return createImageBitmap(bitmap, {
    resizeWidth,
    resizeHeight,
    resizeQuality: "high",
  });
}

export function computeAspectFitScale(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): readonly [number, number] {
  if (
    ![imageWidth, imageHeight, viewportWidth, viewportHeight].every(
      isPositiveFinite,
    )
  ) {
    return [1, 1];
  }

  const imageAspect = imageWidth / imageHeight;
  const viewportAspect = viewportWidth / viewportHeight;

  if (imageAspect > viewportAspect) {
    return [1, viewportAspect / imageAspect];
  }
  return [imageAspect / viewportAspect, 1];
}

export function clampViewportDimensions(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  maxViewportDims: ArrayLike<number> | null | undefined,
): ViewportDimensions {
  const safeDpr = isPositiveFinite(dpr) ? dpr : 1;
  const rawWidth = isPositiveFinite(cssWidth)
    ? Math.max(1, Math.round(cssWidth * safeDpr))
    : 1;
  const rawHeight = isPositiveFinite(cssHeight)
    ? Math.max(1, Math.round(cssHeight * safeDpr))
    : 1;

  const rawMaxW = maxViewportDims?.[0];
  const rawMaxH = maxViewportDims?.[1];
  const limitWidth =
    rawMaxW !== undefined && isPositiveFinite(rawMaxW)
      ? Math.max(1, Math.floor(rawMaxW))
      : rawWidth;
  const limitHeight =
    rawMaxH !== undefined && isPositiveFinite(rawMaxH)
      ? Math.max(1, Math.floor(rawMaxH))
      : rawHeight;

  const scale = Math.min(1, limitWidth / rawWidth, limitHeight / rawHeight);
  return {
    width: Math.max(1, Math.floor(rawWidth * scale)),
    height: Math.max(1, Math.floor(rawHeight * scale)),
  };
}

function computeCenteredSlotRect(
  imageWidth: number,
  imageHeight: number,
  vpWidth: number,
  vpHeight: number,
): NdcRect {
  const [scaleX, scaleY] = computeAspectFitScale(
    imageWidth,
    imageHeight,
    vpWidth,
    vpHeight,
  );
  return {
    xMin: -scaleX,
    xMax: scaleX,
    yMin: -scaleY,
    yMax: scaleY,
  };
}

function computeHalfScreenSlotRect(
  imageWidth: number,
  imageHeight: number,
  vpWidth: number,
  vpHeight: number,
  position: "left" | "right",
): NdcRect {
  const [halfScaleX, halfScaleY] = computeAspectFitScale(
    imageWidth,
    imageHeight,
    vpWidth / 2,
    vpHeight,
  );
  if (position === "left") {
    return {
      xMin: -halfScaleX,
      xMax: 0,
      yMin: -halfScaleY,
      yMax: halfScaleY,
    };
  }
  return {
    xMin: 0,
    xMax: halfScaleX,
    yMin: -halfScaleY,
    yMax: halfScaleY,
  };
}

function computeCombinedSpreadRects(
  leftFrame: ReadyPageFrame,
  rightFrame: ReadyPageFrame,
  vpWidth: number,
  vpHeight: number,
): { readonly left: NdcRect; readonly right: NdcRect } {
  const normWidthL =
    isPositiveFinite(leftFrame.width) && isPositiveFinite(leftFrame.height)
      ? leftFrame.width / leftFrame.height
      : 1;
  const normWidthR =
    isPositiveFinite(rightFrame.width) && isPositiveFinite(rightFrame.height)
      ? rightFrame.width / rightFrame.height
      : 1;
  const combinedAspect = normWidthL + normWidthR;
  const [totalScaleX, totalScaleY] = computeAspectFitScale(
    combinedAspect,
    1,
    vpWidth,
    vpHeight,
  );
  const seamX = -totalScaleX + (2 * totalScaleX * normWidthL) / combinedAspect;

  return {
    left: {
      xMin: -totalScaleX,
      xMax: seamX,
      yMin: -totalScaleY,
      yMax: totalScaleY,
    },
    right: {
      xMin: seamX,
      xMax: totalScaleX,
      yMin: -totalScaleY,
      yMax: totalScaleY,
    },
  };
}

function resolveSlotDrawJobs(
  slots: readonly RenderSlotFrame[],
  vpWidth: number,
  vpHeight: number,
): SlotDrawJob[] {
  if (slots.length === 1) {
    const entry = slots[0];
    if (!isReadyFrame(entry.frame)) {
      return [];
    }
    const rect =
      entry.slot.position === "center"
        ? computeCenteredSlotRect(
            entry.frame.width,
            entry.frame.height,
            vpWidth,
            vpHeight,
          )
        : computeHalfScreenSlotRect(
            entry.frame.width,
            entry.frame.height,
            vpWidth,
            vpHeight,
            entry.slot.position,
          );
    return [{ slot: entry.slot, frame: entry.frame, rect }];
  }

  const leftEntry = slots.find((item) => item.slot.position === "left");
  const rightEntry = slots.find((item) => item.slot.position === "right");
  if (leftEntry !== undefined && rightEntry !== undefined) {
    const leftReady = isReadyFrame(leftEntry.frame) ? leftEntry.frame : null;
    const rightReady = isReadyFrame(rightEntry.frame) ? rightEntry.frame : null;

    if (leftReady !== null && rightReady !== null) {
      const rects = computeCombinedSpreadRects(
        leftReady,
        rightReady,
        vpWidth,
        vpHeight,
      );
      return slots.indexOf(leftEntry) <= slots.indexOf(rightEntry)
        ? [
            { slot: leftEntry.slot, frame: leftReady, rect: rects.left },
            { slot: rightEntry.slot, frame: rightReady, rect: rects.right },
          ]
        : [
            { slot: rightEntry.slot, frame: rightReady, rect: rects.right },
            { slot: leftEntry.slot, frame: leftReady, rect: rects.left },
          ];
    }

    if (leftReady !== null) {
      return [
        {
          slot: leftEntry.slot,
          frame: leftReady,
          rect: computeHalfScreenSlotRect(
            leftReady.width,
            leftReady.height,
            vpWidth,
            vpHeight,
            "left",
          ),
        },
      ];
    }

    if (rightReady !== null) {
      return [
        {
          slot: rightEntry.slot,
          frame: rightReady,
          rect: computeHalfScreenSlotRect(
            rightReady.width,
            rightReady.height,
            vpWidth,
            vpHeight,
            "right",
          ),
        },
      ];
    }

    return [];
  }

  const firstReady = slots.find((item) => isReadyFrame(item.frame));
  if (firstReady === undefined) {
    return [];
  }
  const readyFrame = firstReady.frame as ReadyPageFrame;
  return [
    {
      slot: firstReady.slot,
      frame: readyFrame,
      rect: computeCenteredSlotRect(
        readyFrame.width,
        readyFrame.height,
        vpWidth,
        vpHeight,
      ),
    },
  ];
}

export class WebGLRendererCore {
  private readonly gl: WebGL2RenderingContext;
  private readonly onAsyncTextureReady?: (pageIndex: number) => void;
  private readonly bitmapCropper: BitmapCropper;
  private readonly bitmapResizer: BitmapResizer;
  private pipeline: WebGLPipeline | null = null;
  private maxViewportDims: ArrayLike<number> | null = null;
  private maxTextureSize = DEFAULT_MAX_TEXTURE_SIZE;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private contextGeneration = 0;
  private disposed = false;
  private readonly textures = new Map<number, TextureEntry>();
  private readonly pendingBitmaps = new Map<number, ImageBitmap>();
  private readonly failedOversizedBitmaps = new Map<number, ImageBitmap>();

  constructor(
    gl: WebGL2RenderingContext,
    options: WebGLRendererCoreOptions = {},
  ) {
    this.gl = gl;
    this.onAsyncTextureReady = options.onAsyncTextureReady;
    this.bitmapCropper = options.bitmapCropper ?? defaultBitmapCropper;
    this.bitmapResizer = options.bitmapResizer ?? defaultBitmapResizer;
    this.initPipeline();
  }

  getMaxTextureSize(): number {
    return this.maxTextureSize;
  }

  notifyContextLost(): void {
    if (this.disposed) {
      return;
    }
    this.contextGeneration += 1;
    this.pendingBitmaps.clear();
    this.textures.clear();
    this.failedOversizedBitmaps.clear();
    this.pipeline = null;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): boolean {
    if (this.disposed) {
      return false;
    }

    const { width, height } = clampViewportDimensions(
      cssWidth,
      cssHeight,
      dpr,
      this.maxViewportDims,
    );

    if (this.viewportWidth === width && this.viewportHeight === height) {
      return false;
    }

    this.viewportWidth = width;
    this.viewportHeight = height;

    if (this.gl.canvas.width !== width || this.gl.canvas.height !== height) {
      this.gl.canvas.width = width;
      this.gl.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
    return true;
  }

  renderSlots(slots: readonly RenderSlotFrame[]): readonly ViewportSlot[] {
    if (
      this.disposed ||
      this.pipeline === null ||
      (this.gl.isContextLost?.() ?? false)
    ) {
      return [];
    }

    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    if (slots.length === 0) {
      return [];
    }

    const vpWidth =
      this.viewportWidth > 0 ? this.viewportWidth : this.gl.canvas.width;
    const vpHeight =
      this.viewportHeight > 0 ? this.viewportHeight : this.gl.canvas.height;
    const drawJobs = resolveSlotDrawJobs(slots, vpWidth, vpHeight);
    if (drawJobs.length === 0) {
      return [];
    }

    const preparedJobs: Array<{
      readonly slot: ViewportSlot;
      readonly tiles: readonly TileTexture[];
      readonly rect: NdcRect;
    }> = [];

    for (const job of drawJobs) {
      const tiles = this.ensurePageTexture(job.frame);
      if (tiles !== null) {
        preparedJobs.push({
          slot: job.slot,
          tiles,
          rect: job.rect,
        });
      }
    }

    if (preparedJobs.length === 0) {
      return [];
    }

    this.gl.useProgram(this.pipeline.program);
    this.gl.bindVertexArray(this.pipeline.vao);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.uniform1i(this.pipeline.textureLoc, 0);

    const renderedSlots: ViewportSlot[] = [];
    for (const prepared of preparedJobs) {
      this.drawTilesInRect(this.pipeline, prepared.tiles, prepared.rect);
      renderedSlots.push(prepared.slot);
    }

    this.gl.bindVertexArray(null);
    return renderedSlots;
  }

  renderFrame(frame: DecodedPageFrame | null): void {
    const pageIndex = frame !== null ? frame.pageIndex : 0;
    this.renderSlots([
      {
        slot: { pageIndex, position: "center" },
        frame,
      },
    ]);
  }

  deletePageTexture(pageIndex: number): void {
    this.pendingBitmaps.delete(pageIndex);
    this.failedOversizedBitmaps.delete(pageIndex);
    const entry = this.textures.get(pageIndex);
    if (entry !== undefined) {
      this.textures.delete(pageIndex);
      for (const tile of entry.tiles) {
        this.gl.deleteTexture(tile.texture);
      }
    }
  }

  clearAllTextures(): void {
    this.pendingBitmaps.clear();
    this.failedOversizedBitmaps.clear();
    for (const entry of this.textures.values()) {
      for (const tile of entry.tiles) {
        this.gl.deleteTexture(tile.texture);
      }
    }
    this.textures.clear();
  }

  reinitializeAfterContextLost(): void {
    if (this.disposed) {
      return;
    }
    this.contextGeneration += 1;
    this.pendingBitmaps.clear();
    this.textures.clear();
    this.failedOversizedBitmaps.clear();
    this.pipeline = null;
    this.initPipeline();
    if (this.viewportWidth > 0) {
      this.gl.viewport(0, 0, this.viewportWidth, this.viewportHeight);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.contextGeneration += 1;
    this.clearAllTextures();
    if (this.pipeline !== null) {
      this.gl.deleteVertexArray(this.pipeline.vao);
      this.gl.deleteBuffer(this.pipeline.vbo);
      this.gl.deleteProgram(this.pipeline.program);
      this.pipeline = null;
    }
  }

  private drawTilesInRect(
    pipeline: WebGLPipeline,
    tiles: readonly TileTexture[],
    rect: NdcRect,
  ): void {
    const slotWidth = rect.xMax - rect.xMin;
    const slotHeight = rect.yMax - rect.yMin;

    for (const tile of tiles) {
      const tileXMin = rect.xMin + tile.xFrac * slotWidth;
      const tileXMax = rect.xMin + (tile.xFrac + tile.wFrac) * slotWidth;
      const tileYMax = rect.yMax - tile.yFrac * slotHeight;
      const tileYMin = rect.yMax - (tile.yFrac + tile.hFrac) * slotHeight;

      const scaleX = (tileXMax - tileXMin) / 2;
      const scaleY = (tileYMax - tileYMin) / 2;
      const offsetX = (tileXMin + tileXMax) / 2;
      const offsetY = (tileYMin + tileYMax) / 2;

      this.gl.bindTexture(this.gl.TEXTURE_2D, tile.texture);
      this.gl.uniform2f(pipeline.scaleLoc, scaleX, scaleY);
      this.gl.uniform2f(pipeline.offsetLoc, offsetX, offsetY);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  private isAsyncPrepValid(
    pageIndex: number,
    bitmap: ImageBitmap,
    capturedGen: number,
  ): boolean {
    return (
      !this.disposed &&
      this.contextGeneration === capturedGen &&
      this.pendingBitmaps.get(pageIndex) === bitmap &&
      !(this.gl.isContextLost?.() ?? false)
    );
  }

  private deleteTextureList(textures: WebGLTexture[]): void {
    for (const texture of textures) {
      this.gl.deleteTexture(texture);
    }
    textures.length = 0;
  }

  private handleOversizedFailure(
    frame: ReadyPageFrame,
    createdTextures: WebGLTexture[],
    detail: string,
  ): void {
    this.deleteTextureList(createdTextures);
    this.pendingBitmaps.delete(frame.pageIndex);
    this.failedOversizedBitmaps.set(frame.pageIndex, frame.bitmap);
    diagnosticLogger.error(
      "webgl2",
      "MAX_TEXTURE_SIZE 超過画像のテクスチャ準備に失敗しました",
      `page=${frame.pageIndex}, image=${frame.bitmap.width}x${frame.bitmap.height}, maxTextureSize=${this.maxTextureSize}: ${detail}`,
    );
  }

  private async prepareOversizedTexture(
    frame: ReadyPageFrame,
    capturedGen: number,
    capturedMaxTex: number,
  ): Promise<void> {
    const bw = frame.bitmap.width;
    const bh = frame.bitmap.height;
    const cols = Math.ceil(bw / capturedMaxTex);
    const rows = Math.ceil(bh / capturedMaxTex);
    const tileCount = cols * rows;
    const createdTextures: WebGLTexture[] = [];

    let tiles: TileTexture[] | null = null;
    let cancelled = false;

    if (tileCount <= MAX_SPLIT_TILES) {
      const splitTiles: TileTexture[] = [];
      let splitFailed = false;

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          if (
            !this.isAsyncPrepValid(frame.pageIndex, frame.bitmap, capturedGen)
          ) {
            cancelled = true;
            break;
          }

          const sx = col * capturedMaxTex;
          const sy = row * capturedMaxTex;
          const sw = Math.min(capturedMaxTex, bw - sx);
          const sh = Math.min(capturedMaxTex, bh - sy);

          let tileBitmap: ImageBitmap | null = null;
          try {
            tileBitmap = await this.bitmapCropper(frame.bitmap, sx, sy, sw, sh);
            if (
              !this.isAsyncPrepValid(frame.pageIndex, frame.bitmap, capturedGen)
            ) {
              cancelled = true;
              break;
            }
            const texture = this.uploadBitmapToTexture(tileBitmap);
            if (!texture) {
              if (
                !this.isAsyncPrepValid(
                  frame.pageIndex,
                  frame.bitmap,
                  capturedGen,
                )
              ) {
                cancelled = true;
              } else {
                splitFailed = true;
              }
              break;
            }
            createdTextures.push(texture);
            splitTiles.push({
              texture,
              xFrac: sx / bw,
              yFrac: sy / bh,
              wFrac: sw / bw,
              hFrac: sh / bh,
            });
          } catch {
            if (
              !this.isAsyncPrepValid(frame.pageIndex, frame.bitmap, capturedGen)
            ) {
              cancelled = true;
            } else {
              splitFailed = true;
            }
            break;
          } finally {
            tileBitmap?.close();
          }
        }

        if (cancelled || splitFailed) {
          break;
        }
      }

      if (cancelled) {
        this.deleteTextureList(createdTextures);
        return;
      }

      if (splitFailed) {
        this.deleteTextureList(createdTextures);
      } else {
        tiles = splitTiles;
      }
    }

    if (tiles === null) {
      const { resizeWidth, resizeHeight } = computeResizedDimensions(
        bw,
        bh,
        capturedMaxTex,
      );
      let resizedBitmap: ImageBitmap | null = null;
      try {
        resizedBitmap = await this.bitmapResizer(
          frame.bitmap,
          resizeWidth,
          resizeHeight,
        );
        if (
          !this.isAsyncPrepValid(frame.pageIndex, frame.bitmap, capturedGen)
        ) {
          this.deleteTextureList(createdTextures);
          return;
        }
        const texture = this.uploadBitmapToTexture(resizedBitmap);
        if (!texture) {
          if (
            !this.isAsyncPrepValid(frame.pageIndex, frame.bitmap, capturedGen)
          ) {
            this.deleteTextureList(createdTextures);
            return;
          }
          this.handleOversizedFailure(
            frame,
            createdTextures,
            "createTexture returned null during resize fallback",
          );
          return;
        }
        createdTextures.push(texture);
        tiles = [{ texture, xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1 }];
      } catch (error) {
        if (
          !this.isAsyncPrepValid(frame.pageIndex, frame.bitmap, capturedGen)
        ) {
          this.deleteTextureList(createdTextures);
          return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        this.handleOversizedFailure(frame, createdTextures, detail);
        return;
      } finally {
        resizedBitmap?.close();
      }
    }

    this.pendingBitmaps.delete(frame.pageIndex);
    this.textures.set(frame.pageIndex, {
      bitmap: frame.bitmap,
      tiles,
    });
    this.onAsyncTextureReady?.(frame.pageIndex);
  }

  private ensurePageTexture(
    frame: ReadyPageFrame,
  ): readonly TileTexture[] | null {
    const existing = this.textures.get(frame.pageIndex);
    if (existing !== undefined && existing.bitmap === frame.bitmap) {
      return existing.tiles;
    }

    if (existing !== undefined) {
      for (const tile of existing.tiles) {
        this.gl.deleteTexture(tile.texture);
      }
      this.textures.delete(frame.pageIndex);
    }

    const pending = this.pendingBitmaps.get(frame.pageIndex);
    if (pending === frame.bitmap) {
      return null;
    }
    if (pending !== undefined) {
      this.pendingBitmaps.delete(frame.pageIndex);
    }

    if (this.failedOversizedBitmaps.get(frame.pageIndex) === frame.bitmap) {
      return null;
    }
    this.failedOversizedBitmaps.delete(frame.pageIndex);

    const bw = frame.bitmap.width;
    const bh = frame.bitmap.height;
    if (bw > this.maxTextureSize || bh > this.maxTextureSize) {
      const cols = Math.ceil(bw / this.maxTextureSize);
      const rows = Math.ceil(bh / this.maxTextureSize);
      const tileCount = cols * rows;
      const strategy =
        tileCount <= MAX_SPLIT_TILES
          ? `tile-split (${cols}x${rows}=${tileCount})`
          : `resize-fallback (tiles=${tileCount} > ${MAX_SPLIT_TILES})`;
      diagnosticLogger.warn(
        "webgl2",
        "画像サイズが MAX_TEXTURE_SIZE を超過したため分割/縮小フォールバックを実行します",
        `page=${frame.pageIndex}, image=${bw}x${bh}, maxTextureSize=${this.maxTextureSize}, strategy=${strategy}`,
      );
      this.pendingBitmaps.set(frame.pageIndex, frame.bitmap);
      void this.prepareOversizedTexture(
        frame,
        this.contextGeneration,
        this.maxTextureSize,
      );
      return null;
    }

    const texture = this.uploadBitmapToTexture(frame.bitmap);
    if (!texture) {
      return null;
    }
    const tiles: readonly TileTexture[] = [
      { texture, xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1 },
    ];
    this.textures.set(frame.pageIndex, {
      bitmap: frame.bitmap,
      tiles,
    });
    return tiles;
  }

  private uploadBitmapToTexture(bitmap: ImageBitmap): WebGLTexture | null {
    const texture = this.gl.createTexture();
    if (!texture) {
      return null;
    }

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      bitmap,
    );
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR_MIPMAP_LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE,
    );
    return texture;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new WebGLInitError(
        `シェーダーオブジェクトの生成に失敗しました (type=${type})`,
      );
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader) ?? "unknown error";
      this.gl.deleteShader(shader);
      throw new WebGLInitError(`シェーダーのコンパイルに失敗しました: ${info}`);
    }
    return shader;
  }

  private setupQuadGeometry(
    positionLoc: number,
    texCoordLoc: number,
  ): { vao: WebGLVertexArrayObject; vbo: WebGLBuffer } {
    const vao = this.gl.createVertexArray();
    const vbo = this.gl.createBuffer();
    if (!vao || !vbo) {
      if (vao) {
        this.gl.deleteVertexArray(vao);
      }
      if (vbo) {
        this.gl.deleteBuffer(vbo);
      }
      throw new WebGLInitError("VAOまたはVBOの生成に失敗しました");
    }

    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    this.gl.bindVertexArray(vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vbo);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      QUAD_VERTICES,
      this.gl.STATIC_DRAW,
    );
    this.gl.enableVertexAttribArray(positionLoc);
    this.gl.vertexAttribPointer(
      positionLoc,
      2,
      this.gl.FLOAT,
      false,
      stride,
      0,
    );
    this.gl.enableVertexAttribArray(texCoordLoc);
    this.gl.vertexAttribPointer(
      texCoordLoc,
      2,
      this.gl.FLOAT,
      false,
      stride,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    this.gl.bindVertexArray(null);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);

    return { vao, vbo };
  }

  private initPipeline(): void {
    const vertexShader = this.compileShader(
      this.gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
    );
    let fragmentShader: WebGLShader | null = null;
    let program: WebGLProgram | null = null;

    try {
      fragmentShader = this.compileShader(
        this.gl.FRAGMENT_SHADER,
        FRAGMENT_SHADER_SOURCE,
      );
      program = this.gl.createProgram();
      if (!program) {
        throw new WebGLInitError("WebGLプログラムの生成に失敗しました");
      }

      this.gl.attachShader(program, vertexShader);
      this.gl.attachShader(program, fragmentShader);
      this.gl.linkProgram(program);
      if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
        const info = this.gl.getProgramInfoLog(program) ?? "unknown error";
        throw new WebGLInitError(
          `WebGLプログラムのリンクに失敗しました: ${info}`,
        );
      }

      const positionLoc = this.gl.getAttribLocation(program, "a_position");
      const texCoordLoc = this.gl.getAttribLocation(program, "a_texCoord");
      const scaleLoc = this.gl.getUniformLocation(program, "u_scale");
      const offsetLoc = this.gl.getUniformLocation(program, "u_offset");
      const textureLoc = this.gl.getUniformLocation(program, "u_texture");
      if (
        positionLoc < 0 ||
        texCoordLoc < 0 ||
        scaleLoc === null ||
        offsetLoc === null ||
        textureLoc === null
      ) {
        throw new WebGLInitError(
          "シェーダーのattribute/uniformロケーション取得に失敗しました",
        );
      }

      const { vao, vbo } = this.setupQuadGeometry(positionLoc, texCoordLoc);

      this.gl.deleteShader(vertexShader);
      this.gl.deleteShader(fragmentShader);

      this.pipeline = {
        program,
        vao,
        vbo,
        scaleLoc,
        offsetLoc,
        textureLoc,
      };
      this.maxViewportDims = this.gl.getParameter(
        this.gl.MAX_VIEWPORT_DIMS,
      ) as ArrayLike<number> | null;
      this.maxTextureSize = normalizeMaxTextureSize(
        this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE),
      );
      this.gl.clearColor(0, 0, 0, 1);
    } catch (error) {
      if (program) {
        this.gl.deleteProgram(program);
      }
      this.gl.deleteShader(vertexShader);
      if (fragmentShader) {
        this.gl.deleteShader(fragmentShader);
      }
      throw error;
    }
  }
}

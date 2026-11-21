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
  readonly textureLoc: WebGLUniformLocation;
}

interface TextureEntry {
  readonly texture: WebGLTexture;
  readonly bitmap: ImageBitmap;
}

const QUAD_VERTICES = new Float32Array([
  -1, 1, 0, 0, -1, -1, 0, 1, 1, 1, 1, 0, 1, -1, 1, 1,
]);

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
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

export class WebGLRendererCore {
  private readonly gl: WebGL2RenderingContext;
  private pipeline: WebGLPipeline | null = null;
  private maxViewportDims: ArrayLike<number> | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private disposed = false;
  private readonly textures = new Map<number, TextureEntry>();

  constructor(
    gl: WebGL2RenderingContext,
    _options: WebGLRendererCoreOptions = {},
  ) {
    this.gl = gl;
    this.initPipeline();
  }

  getMaxTextureSize(): number {
    throw new Error("Not implemented");
  }

  notifyContextLost(): void {
    throw new Error("Not implemented");
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

  renderSlots(_slots: readonly RenderSlotFrame[]): readonly ViewportSlot[] {
    throw new Error("Not implemented");
  }

  renderFrame(frame: DecodedPageFrame | null): void {
    if (this.disposed || this.pipeline === null) {
      return;
    }

    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    if (frame === null || frame.status !== "ready") {
      return;
    }

    if (!this.ensurePageTexture(frame)) {
      return;
    }

    const vpWidth =
      this.viewportWidth > 0 ? this.viewportWidth : this.gl.canvas.width;
    const vpHeight =
      this.viewportHeight > 0 ? this.viewportHeight : this.gl.canvas.height;
    const [scaleX, scaleY] = computeAspectFitScale(
      frame.width,
      frame.height,
      vpWidth,
      vpHeight,
    );

    this.gl.useProgram(this.pipeline.program);
    this.gl.bindVertexArray(this.pipeline.vao);
    this.gl.uniform2f(this.pipeline.scaleLoc, scaleX, scaleY);
    this.gl.uniform1i(this.pipeline.textureLoc, 0);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    this.gl.bindVertexArray(null);
  }

  deletePageTexture(pageIndex: number): void {
    const entry = this.textures.get(pageIndex);
    if (entry !== undefined) {
      this.textures.delete(pageIndex);
      this.gl.deleteTexture(entry.texture);
    }
  }

  clearAllTextures(): void {
    for (const entry of this.textures.values()) {
      this.gl.deleteTexture(entry.texture);
    }
    this.textures.clear();
  }

  reinitializeAfterContextLost(): void {
    if (this.disposed) {
      return;
    }
    this.textures.clear();
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
    this.clearAllTextures();
    if (this.pipeline !== null) {
      this.gl.deleteVertexArray(this.pipeline.vao);
      this.gl.deleteBuffer(this.pipeline.vbo);
      this.gl.deleteProgram(this.pipeline.program);
      this.pipeline = null;
    }
  }

  private ensurePageTexture(frame: ReadyPageFrame): boolean {
    const existing = this.textures.get(frame.pageIndex);
    if (existing !== undefined && existing.bitmap === frame.bitmap) {
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, existing.texture);
      return true;
    }

    if (existing !== undefined) {
      this.gl.deleteTexture(existing.texture);
      this.textures.delete(frame.pageIndex);
    }

    const texture = this.gl.createTexture();
    if (!texture) {
      return false;
    }
    this.textures.set(frame.pageIndex, {
      texture,
      bitmap: frame.bitmap,
    });

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      frame.bitmap,
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
    return true;
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
      const textureLoc = this.gl.getUniformLocation(program, "u_texture");
      if (
        positionLoc < 0 ||
        texCoordLoc < 0 ||
        scaleLoc === null ||
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
        textureLoc,
      };
      this.maxViewportDims = this.gl.getParameter(
        this.gl.MAX_VIEWPORT_DIMS,
      ) as ArrayLike<number> | null;
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

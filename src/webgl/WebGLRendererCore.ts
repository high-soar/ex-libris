import type { DecodedPageFrame } from "../engine/types";

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

export function computeAspectFitScale(
  _imageWidth: number,
  _imageHeight: number,
  _viewportWidth: number,
  _viewportHeight: number,
): readonly [number, number] {
  return [0, 0];
}

export function clampViewportDimensions(
  _cssWidth: number,
  _cssHeight: number,
  _dpr: number,
  _maxViewportDims: ArrayLike<number> | null | undefined,
): ViewportDimensions {
  return { width: 0, height: 0 };
}

export class WebGLRendererCore {
  constructor(_gl: WebGL2RenderingContext) {}

  resize(_cssWidth: number, _cssHeight: number, _dpr: number): boolean {
    return false;
  }

  renderFrame(_frame: DecodedPageFrame | null): void {}

  deletePageTexture(_pageIndex: number): void {}

  clearAllTextures(): void {}

  reinitializeAfterContextLost(): void {}

  dispose(): void {}
}

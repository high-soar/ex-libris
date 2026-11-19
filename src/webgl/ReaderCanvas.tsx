import type { DecodedPageFrame } from "../engine/types";

export type WebGLStatus = "initializing" | "ready" | "context-lost" | "error";
export type WebGLFatalErrorCode = "WEBGL_UNSUPPORTED" | "WEBGL_INIT_FAILED";

export interface ReaderCanvasHandle {
  deletePageTexture: (pageIndex: number) => void;
  clearAllTextures: () => void;
}

export interface ReaderCanvasProps {
  frame: DecodedPageFrame | null;
  onRendererReady?: (handle: ReaderCanvasHandle | null) => void;
  onFatalError?: (code: WebGLFatalErrorCode, message: string) => void;
  getWebGL2Context?: (
    canvas: HTMLCanvasElement,
  ) => WebGL2RenderingContext | null;
}

export function ReaderCanvas(_props: ReaderCanvasProps) {
  return (
    <canvas
      data-testid="reader-canvas"
      data-webgl-status="initializing"
      data-rendered-page=""
      data-rendered-epoch=""
      className="block h-full w-full bg-black"
    />
  );
}

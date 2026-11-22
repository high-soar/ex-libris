import { useCallback, useEffect, useRef, useState } from "react";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { WebGLRendererCore } from "./WebGLRendererCore";
import type { ReadyPageFrame } from "./l1PageCache";
import type {
  RenderSlotFrame,
  ShaderCorrectionParams,
  ViewportSlot,
} from "./types";

export type WebGLStatus = "initializing" | "ready" | "context-lost" | "error";
export type WebGLFatalErrorCode = "WEBGL_UNSUPPORTED" | "WEBGL_INIT_FAILED";

export interface ReaderCanvasHandle {
  deletePageTexture: (pageIndex: number) => void;
  clearAllTextures: () => void;
}

export interface ReaderCanvasProps {
  readonly slots: readonly RenderSlotFrame[];
  readonly shaderParams?: ShaderCorrectionParams;
  readonly onRendererReady?: (handle: ReaderCanvasHandle | null) => void;
  readonly onFatalError?: (code: WebGLFatalErrorCode, message: string) => void;
  readonly getWebGL2Context?: (
    canvas: HTMLCanvasElement,
  ) => WebGL2RenderingContext | null;
}

interface RenderedState {
  readonly page: string;
  readonly pages: string;
  readonly slots: string;
  readonly epoch: string;
}

const EMPTY_RENDERED: RenderedState = {
  page: "",
  pages: "",
  slots: "",
  epoch: "",
};
const DEFAULT_INIT_ERROR_MESSAGE = "WebGL2 描画の初期化に失敗しました";

function defaultGetWebGL2Context(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
}

function getWebGLInitErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : DEFAULT_INIT_ERROR_MESSAGE;
}

function readElementCssSize(
  canvas: HTMLCanvasElement,
  observerEntry?: ResizeObserverEntry,
): { width: number; height: number } {
  const rect = observerEntry
    ? observerEntry.contentRect
    : canvas.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : canvas.clientWidth,
    height: rect.height > 0 ? rect.height : canvas.clientHeight,
  };
}

function createRendererHandle(renderer: WebGLRendererCore): ReaderCanvasHandle {
  return {
    deletePageTexture: (pageIndex) => {
      renderer.deletePageTexture(pageIndex);
    },
    clearAllTextures: () => {
      renderer.clearAllTextures();
    },
  };
}

function isReadySlotFrame(
  entry: RenderSlotFrame,
): entry is { readonly slot: ViewportSlot; readonly frame: ReadyPageFrame } {
  return entry.frame !== null && entry.frame.status === "ready";
}

function buildRenderedState(
  renderedSlots: readonly ViewportSlot[],
  sourceSlots: readonly RenderSlotFrame[],
): RenderedState {
  const uniqueSortedPages = Array.from(
    new Set(renderedSlots.map((slot) => slot.pageIndex)),
  ).sort((a, b) => a - b);

  const renderedKeys = new Set(
    renderedSlots.map((slot) => `${slot.position}:${slot.pageIndex}`),
  );
  const renderedEpochs = sourceSlots
    .filter(isReadySlotFrame)
    .filter((entry) =>
      renderedKeys.has(`${entry.slot.position}:${entry.slot.pageIndex}`),
    )
    .map((entry) => entry.frame.epoch);

  return {
    page: String(uniqueSortedPages[0]),
    pages: uniqueSortedPages.join(","),
    slots: renderedSlots
      .map((slot) => `${slot.position}:${slot.pageIndex}`)
      .join(","),
    epoch: String(Math.max(...renderedEpochs)),
  };
}

export function ReaderCanvas({
  slots,
  shaderParams: _shaderParams,
  onRendererReady,
  onFatalError,
  getWebGL2Context,
}: ReaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGLRendererCore | null>(null);
  const isContextLostRef = useRef(false);
  const lastRenderedKeyRef = useRef("");

  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const onRendererReadyRef = useRef(onRendererReady);
  onRendererReadyRef.current = onRendererReady;
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;
  const getWebGL2ContextRef = useRef(getWebGL2Context);
  getWebGL2ContextRef.current = getWebGL2Context;

  const [status, setStatus] = useState<WebGLStatus>("initializing");
  const [rendered, setRendered] = useState<RenderedState>(EMPTY_RENDERED);

  const clearRenderedState = useCallback(() => {
    if (lastRenderedKeyRef.current !== "") {
      lastRenderedKeyRef.current = "";
      setRendered(EMPTY_RENDERED);
    }
  }, []);

  const applySlots = useCallback(
    (renderer: WebGLRendererCore, nextSlots: readonly RenderSlotFrame[]) => {
      const renderedSlots = renderer.renderSlots(nextSlots);
      if (renderedSlots.length === 0) {
        clearRenderedState();
        return;
      }

      const nextState = buildRenderedState(renderedSlots, nextSlots);
      const nextKey = `${nextState.page}|${nextState.pages}|${nextState.slots}|${nextState.epoch}`;
      if (lastRenderedKeyRef.current !== nextKey) {
        lastRenderedKeyRef.current = nextKey;
        setRendered(nextState);
      }
    },
    [clearRenderedState],
  );

  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const reportFatalError = (
      code: WebGLFatalErrorCode,
      logMessage: string,
      detail: string,
      userMessage: string,
    ) => {
      diagnosticLogger.error("webgl2", logMessage, detail);
      setStatus("error");
      onRendererReadyRef.current?.(null);
      onFatalErrorRef.current?.(code, userMessage);
    };

    const resolveContext =
      getWebGL2ContextRef.current ?? defaultGetWebGL2Context;
    const gl = resolveContext(canvas);

    if (!gl) {
      reportFatalError(
        "WEBGL_UNSUPPORTED",
        DEFAULT_INIT_ERROR_MESSAGE,
        "WebGL2 context unavailable",
        DEFAULT_INIT_ERROR_MESSAGE,
      );
      return;
    }

    let renderer: WebGLRendererCore;
    try {
      renderer = new WebGLRendererCore(gl, {
        onAsyncTextureReady: () => {
          if (rendererRef.current !== renderer || isContextLostRef.current) {
            return;
          }
          applySlots(renderer, slotsRef.current);
        },
      });
    } catch (error) {
      const message = getWebGLInitErrorMessage(error);
      reportFatalError(
        "WEBGL_INIT_FAILED",
        "WebGLRendererCore initialization failed",
        message,
        message,
      );
      return;
    }

    rendererRef.current = renderer;
    isContextLostRef.current = false;

    const handle = createRendererHandle(renderer);
    const readDpr = (): number =>
      window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const syncSize = (entry?: ResizeObserverEntry): boolean => {
      const { width, height } = readElementCssSize(canvas, entry);
      return renderer.resize(width, height, readDpr());
    };

    syncSize();
    setStatus("ready");
    onRendererReadyRef.current?.(handle);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      isContextLostRef.current = true;
      renderer.notifyContextLost();
      diagnosticLogger.warn(
        "webgl2",
        "WebGL2 コンテキストがロストしました（自動復帰待機）",
      );
      setStatus("context-lost");
      clearRenderedState();
      onRendererReadyRef.current?.(null);
    };

    const handleContextRestored = () => {
      try {
        renderer.reinitializeAfterContextLost();
      } catch (error) {
        const message = getWebGLInitErrorMessage(error);
        reportFatalError(
          "WEBGL_INIT_FAILED",
          "WebGL2 context restoration failed",
          message,
          message,
        );
        return;
      }

      isContextLostRef.current = false;
      syncSize();
      applySlots(renderer, slotsRef.current);
      setStatus("ready");
      onRendererReadyRef.current?.(handle);
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        if (isContextLostRef.current) {
          return;
        }
        const resized = syncSize(entries[0]);
        if (resized) {
          applySlots(renderer, slotsRef.current);
        }
      });
      observer.observe(canvas);
    }

    let dprMediaQueryList: MediaQueryList | null = null;
    function cleanupDprListener(): void {
      if (dprMediaQueryList !== null) {
        dprMediaQueryList.removeEventListener("change", handleDprChange);
        dprMediaQueryList = null;
      }
    }
    function handleDprChange(): void {
      bindDprListener();
      if (!isContextLostRef.current && syncSize()) {
        applySlots(renderer, slotsRef.current);
      }
    }
    function bindDprListener(): void {
      cleanupDprListener();
      dprMediaQueryList = window.matchMedia(`(resolution: ${readDpr()}dppx)`);
      dprMediaQueryList.addEventListener("change", handleDprChange);
    }
    if (typeof window.matchMedia === "function") {
      bindDprListener();
    }

    return () => {
      cleanupDprListener();
      observer?.disconnect();
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      rendererRef.current = null;
      renderer.dispose();
      onRendererReadyRef.current?.(null);
    };
  }, [applySlots, clearRenderedState]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null || isContextLostRef.current) {
      return;
    }
    applySlots(renderer, slots);
  }, [applySlots, slots]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="reader-canvas"
      data-webgl-status={status}
      data-rendered-page={rendered.page}
      data-rendered-pages={rendered.pages}
      data-rendered-slots={rendered.slots}
      data-rendered-epoch={rendered.epoch}
      className="block h-full w-full bg-black"
    />
  );
}

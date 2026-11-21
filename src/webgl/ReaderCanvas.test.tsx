import { composeStories } from "@storybook/react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DecodedPageFrame } from "../engine/types";
import { ReaderCanvas, type ReaderCanvasHandle } from "./ReaderCanvas";
import * as stories from "./ReaderCanvas.stories";
import * as WebGLRendererCoreModule from "./WebGLRendererCore";
import type { RenderSlotFrame } from "./types";

const {
  Default,
  SingleSlot,
  SpreadSlots,
  AsyncOversizedPending,
  ContextLost,
  UnsupportedEnvironment,
} = composeStories(stories);

function createFakeBitmap(width = 800, height = 1200): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function createReadyFrame(
  pageIndex: number,
  epoch: number,
  bitmap = createFakeBitmap(),
): Extract<DecodedPageFrame, { status: "ready" }> {
  return {
    status: "ready",
    pageIndex,
    epoch,
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
  };
}

function createErrorFrame(
  pageIndex: number,
  epoch: number,
): Extract<DecodedPageFrame, { status: "error" }> {
  return {
    status: "error",
    pageIndex,
    epoch,
    errorCode: "DECODE_FAILED",
    message: "decode failed",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface MockCanvasGLOptions {
  failCompile?: boolean;
  throwNonErrorOnCreateShader?: boolean;
  failOnSecondInit?: boolean;
  maxTextureSize?: number;
}

function createMockWebGL2Context(options: MockCanvasGLOptions = {}) {
  let shaderInitCount = 0;
  let textureSeq = 0;
  const canvasState = { width: 300, height: 150 };
  const MAX_TEXTURE_SIZE = 0x0d33;

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    MAX_VIEWPORT_DIMS: 0x0d3a,
    MAX_TEXTURE_SIZE,
    COLOR_BUFFER_BIT: 0x4000,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    UNPACK_ALIGNMENT: 0x0cf5,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TRIANGLE_STRIP: 0x0005,
    canvas: canvasState,
    isContextLost: vi.fn(() => false),
    createShader: vi.fn((type: number) => {
      if (type === 0x8b31) {
        shaderInitCount += 1;
      }
      if (options.throwNonErrorOnCreateShader) {
        throw "raw shader string error";
      }
      if (options.failOnSecondInit && shaderInitCount >= 2) {
        throw new Error("再初期化失敗");
      }
      return { type } as unknown as WebGLShader;
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => !options.failCompile),
    getShaderInfoLog: vi.fn(() => "compile error"),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({}) as WebGLProgram),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteProgram: vi.fn(),
    getAttribLocation: vi.fn((_p: WebGLProgram, name: string) =>
      name === "a_position" ? 0 : 1,
    ),
    getUniformLocation: vi.fn((_p: WebGLProgram, name: string) => ({
      name,
    })) as unknown as (
      program: WebGLProgram,
      name: string,
    ) => WebGLUniformLocation,
    createVertexArray: vi.fn(() => ({}) as WebGLVertexArrayObject),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    createBuffer: vi.fn(() => ({}) as WebGLBuffer),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getParameter: vi.fn((pname: number) =>
      pname === MAX_TEXTURE_SIZE
        ? (options.maxTextureSize ?? 4096)
        : new Int32Array([4096, 4096]),
    ),
    clearColor: vi.fn(),
    clear: vi.fn(),
    viewport: vi.fn(),
    createTexture: vi.fn(() => {
      textureSeq += 1;
      return { id: textureSeq } as unknown as WebGLTexture;
    }),
    deleteTexture: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(),
    generateMipmap: vi.fn(),
    texParameteri: vi.fn(),
    useProgram: vi.fn(),
    uniform2f: vi.fn(),
    uniform1i: vi.fn(),
    drawArrays: vi.fn(),
  };

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    mocks: gl,
  };
}

describe("ReaderCanvas", () => {
  const originalDprDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "devicePixelRatio",
  );

  beforeEach(() => {
    diagnosticLogger.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalDprDescriptor) {
      Object.defineProperty(window, "devicePixelRatio", originalDprDescriptor);
    } else {
      Reflect.deleteProperty(window, "devicePixelRatio");
    }
  });

  it("全Storybookストーリーを描画でき2スロット見開き・非同期待機・コンテキストロスト・非対応状態を検証すること (AC-GL-02, AC-GL-05, AC-GL-07, AC-GL-08)", async () => {
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);

    const { unmount: unmountDefault } = render(<Default />);
    const defaultCanvas = screen.getByTestId("reader-canvas");
    expect(defaultCanvas).toHaveAttribute("data-webgl-status", "error");
    expect(defaultCanvas).toHaveAttribute("data-rendered-page", "");
    expect(defaultCanvas).toHaveAttribute("data-rendered-pages", "");
    expect(defaultCanvas).toHaveAttribute("data-rendered-slots", "");
    expect(defaultCanvas).toHaveAttribute("data-rendered-epoch", "");
    expect(getContextSpy).toHaveBeenCalledWith(
      "webgl2",
      expect.objectContaining({ alpha: false }),
    );
    unmountDefault();

    const { gl: glSingle } = createMockWebGL2Context();
    const { unmount: unmountSingle } = render(
      <SingleSlot getWebGL2Context={() => glSingle} />,
    );
    const singleCanvas = screen.getByTestId("reader-canvas");
    expect(singleCanvas).toHaveAttribute("data-webgl-status", "ready");
    expect(singleCanvas).toHaveAttribute("data-rendered-page", "0");
    expect(singleCanvas).toHaveAttribute("data-rendered-pages", "0");
    expect(singleCanvas).toHaveAttribute("data-rendered-slots", "center:0");
    expect(singleCanvas).toHaveAttribute("data-rendered-epoch", "1");
    unmountSingle();

    const { gl: glSpread } = createMockWebGL2Context();
    const { unmount: unmountSpread } = render(
      <SpreadSlots getWebGL2Context={() => glSpread} />,
    );
    const spreadCanvas = screen.getByTestId("reader-canvas");
    expect(spreadCanvas).toHaveAttribute("data-webgl-status", "ready");
    expect(spreadCanvas).toHaveAttribute("data-rendered-page", "1");
    expect(spreadCanvas).toHaveAttribute("data-rendered-pages", "1,2");
    expect(spreadCanvas).toHaveAttribute(
      "data-rendered-slots",
      "left:2,right:1",
    );
    expect(spreadCanvas).toHaveAttribute("data-rendered-epoch", "2");
    unmountSpread();

    const deferredTile = createDeferred<ImageBitmap>();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn((source: unknown) =>
        source instanceof HTMLCanvasElement
          ? Promise.resolve(createFakeBitmap(200, 100))
          : deferredTile.promise,
      ),
    );
    const { unmount: unmountAsync } = render(<AsyncOversizedPending />);
    await waitFor(() => {
      expect(screen.getByTestId("reader-canvas")).toHaveAttribute(
        "data-webgl-status",
        "ready",
      );
    });
    const asyncCanvas = screen.getByTestId("reader-canvas");
    expect(asyncCanvas).toHaveAttribute("data-rendered-slots", "");
    await act(async () => {
      deferredTile.resolve(createFakeBitmap(100, 100));
      await flushMicrotasks();
    });
    expect(asyncCanvas).toHaveAttribute("data-rendered-slots", "center:0");
    unmountAsync();

    const { unmount: unmountLost } = render(<ContextLost />);
    const lostCanvas = screen.getByTestId("reader-canvas");
    expect(lostCanvas).toHaveAttribute("data-webgl-status", "context-lost");
    expect(lostCanvas).toHaveAttribute("data-rendered-page", "");
    expect(lostCanvas).toHaveAttribute("data-rendered-pages", "");
    expect(lostCanvas).toHaveAttribute("data-rendered-slots", "");
    expect(lostCanvas).toHaveAttribute("data-rendered-epoch", "");
    unmountLost();

    const onFatalError = vi.fn();
    const onRendererReady = vi.fn();
    render(
      <UnsupportedEnvironment
        onFatalError={onFatalError}
        onRendererReady={onRendererReady}
      />,
    );
    const unsupportedCanvas = screen.getByTestId("reader-canvas");
    expect(unsupportedCanvas).toHaveAttribute("data-webgl-status", "error");
    expect(onRendererReady).toHaveBeenCalledWith(null);
    expect(onFatalError).toHaveBeenCalledWith(
      "WEBGL_UNSUPPORTED",
      expect.any(String),
    );
  });

  it("WebGL2初期化成功時に単スロット/2スロット描画・混合epoch・部分エラー属性出力・ハンドル操作・破棄を行えること (AC-GL-02, AC-GL-03, AC-GL-08)", () => {
    const { gl, mocks } = createMockWebGL2Context();
    const handleRef: { current: ReaderCanvasHandle | null } = { current: null };
    const onRendererReady = vi.fn((handle: ReaderCanvasHandle | null) => {
      handleRef.current = handle;
    });

    const { rerender, unmount } = render(
      <ReaderCanvas
        slots={[]}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );

    const canvas = screen.getByTestId("reader-canvas");
    expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    expect(canvas).toHaveAttribute("data-rendered-page", "");
    expect(canvas).toHaveAttribute("data-rendered-pages", "");
    expect(canvas).toHaveAttribute("data-rendered-slots", "");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "");
    expect(handleRef.current).not.toBeNull();

    // 単スロット ready フレームを描画すると属性と WebGL 描画が更新される
    const frame0 = createReadyFrame(0, 1);
    rerender(
      <ReaderCanvas
        slots={[{ slot: { pageIndex: 0, position: "center" }, frame: frame0 }]}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(canvas).toHaveAttribute("data-rendered-page", "0");
    expect(canvas).toHaveAttribute("data-rendered-pages", "0");
    expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "1");
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);

    // 2スロット見開き (rtl: left:2 [epoch 2], right:1 [epoch 4]) -> 最小頁 "1", 昇順 "1,2", スロット順 "left:2,right:1", 最大epoch "4"
    const spreadSlots: RenderSlotFrame[] = [
      {
        slot: { pageIndex: 2, position: "left" },
        frame: createReadyFrame(2, 2),
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: createReadyFrame(1, 4),
      },
    ];
    rerender(
      <ReaderCanvas
        slots={spreadSlots}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(canvas).toHaveAttribute("data-rendered-page", "1");
    expect(canvas).toHaveAttribute("data-rendered-pages", "1,2");
    expect(canvas).toHaveAttribute("data-rendered-slots", "left:2,right:1");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "4");

    // 2スロット片側エラー・片側null混在時は健全側スロットのみ出力する
    rerender(
      <ReaderCanvas
        slots={[
          {
            slot: { pageIndex: 3, position: "left" },
            frame: createErrorFrame(3, 5),
          },
          {
            slot: { pageIndex: 2, position: "right" },
            frame: createReadyFrame(2, 5),
          },
        ]}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(canvas).toHaveAttribute("data-rendered-page", "2");
    expect(canvas).toHaveAttribute("data-rendered-pages", "2");
    expect(canvas).toHaveAttribute("data-rendered-slots", "right:2");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "5");

    // 公開ハンドル経由で個別テクスチャ破棄と全テクスチャ破棄を実行できる
    mocks.deleteTexture.mockClear();
    handleRef.current?.deletePageTexture(0);
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(1);

    handleRef.current?.clearAllTextures();
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(3);

    // 全スロット error / null 時は描画済み属性を空に戻す
    rerender(
      <ReaderCanvas
        slots={[
          {
            slot: { pageIndex: 4, position: "left" },
            frame: createErrorFrame(4, 6),
          },
          { slot: { pageIndex: 3, position: "right" }, frame: null },
        ]}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(canvas).toHaveAttribute("data-rendered-page", "");
    expect(canvas).toHaveAttribute("data-rendered-pages", "");
    expect(canvas).toHaveAttribute("data-rendered-slots", "");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "");

    // アンマウント時にハンドルを null 通知し、renderer を dispose する
    unmount();
    expect(onRendererReady).toHaveBeenLastCalledWith(null);
    expect(mocks.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it("MAX_TEXTURE_SIZE超過スロットの非同期準備完了時に最新のslotsRefを再描画しDOM属性を更新すること (AC-GL-07, AC-GL-08)", async () => {
    const tile1 = createDeferred<ImageBitmap>();
    const tile2 = createDeferred<ImageBitmap>();
    let cropCall = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        cropCall += 1;
        return cropCall === 1 ? tile1.promise : tile2.promise;
      }),
    );

    const { gl } = createMockWebGL2Context({ maxTextureSize: 100 });
    const leftNormal = createReadyFrame(1, 2, createFakeBitmap(50, 100));
    const rightOversized = createReadyFrame(0, 3, createFakeBitmap(150, 100));

    render(
      <ReaderCanvas
        slots={[
          { slot: { pageIndex: 1, position: "left" }, frame: leftNormal },
          { slot: { pageIndex: 0, position: "right" }, frame: rightOversized },
        ]}
        getWebGL2Context={() => gl}
      />,
    );

    const canvas = screen.getByTestId("reader-canvas");
    // 初回同期描画では通常サイズ側 left:1 のみ完了
    expect(canvas).toHaveAttribute("data-rendered-page", "1");
    expect(canvas).toHaveAttribute("data-rendered-pages", "1");
    expect(canvas).toHaveAttribute("data-rendered-slots", "left:1");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "2");

    // 2枚のタイル生成完了後、onAsyncTextureReady で最新 slotsRef が再描画される
    await act(async () => {
      tile1.resolve(createFakeBitmap(100, 100));
      tile2.resolve(createFakeBitmap(50, 100));
      await flushMicrotasks();
    });

    expect(canvas).toHaveAttribute("data-rendered-page", "0");
    expect(canvas).toHaveAttribute("data-rendered-pages", "0,1");
    expect(canvas).toHaveAttribute("data-rendered-slots", "left:1,right:0");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "3");
  });

  it("onAsyncTextureReadyがcontext-lost後およびunmount/dispose後に発火しても安全ガードで再描画しないこと (AC-GL-05, AC-GL-07)", () => {
    const renderSlotsSpy = vi.spyOn(
      WebGLRendererCoreModule.WebGLRendererCore.prototype,
      "renderSlots",
    );

    const { gl } = createMockWebGL2Context();
    const frame0 = createReadyFrame(0, 1);

    const { unmount } = render(
      <ReaderCanvas
        slots={[{ slot: { pageIndex: 0, position: "center" }, frame: frame0 }]}
        getWebGL2Context={() => gl}
      />,
    );

    const instance = renderSlotsSpy.mock.instances[0] as unknown as
      { onAsyncTextureReady?: (pageIndex: number) => void } | undefined;
    const callback = instance?.onAsyncTextureReady;
    expect(callback).toBeTypeOf("function");
    expect(renderSlotsSpy).toHaveBeenCalledTimes(1);

    // 1. context-lost 中の onAsyncTextureReady はガードによりスキップ
    const canvas = screen.getByTestId("reader-canvas");
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    renderSlotsSpy.mockClear();
    act(() => {
      callback?.(0);
    });
    expect(renderSlotsSpy).not.toHaveBeenCalled();

    // 2. context-restored 後は再び onAsyncTextureReady が動作する
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });
    renderSlotsSpy.mockClear();
    act(() => {
      callback?.(0);
    });
    expect(renderSlotsSpy).toHaveBeenCalledTimes(1);

    // 3. unmount / dispose 後の onAsyncTextureReady もガードによりスキップ
    unmount();
    renderSlotsSpy.mockClear();
    callback?.(0);
    expect(renderSlotsSpy).not.toHaveBeenCalled();
  });

  it("WebGLRendererCore初期化失敗時にWEBGL_INIT_FAILEDを通知すること（Errorおよび非Error送出含む）", () => {
    const { gl: glFailCompile } = createMockWebGL2Context({
      failCompile: true,
    });
    const onFatalError = vi.fn();
    const onRendererReady = vi.fn();

    const { unmount } = render(
      <ReaderCanvas
        slots={[]}
        getWebGL2Context={() => glFailCompile}
        onFatalError={onFatalError}
        onRendererReady={onRendererReady}
      />,
    );

    expect(screen.getByTestId("reader-canvas")).toHaveAttribute(
      "data-webgl-status",
      "error",
    );
    expect(onRendererReady).toHaveBeenCalledWith(null);
    expect(onFatalError).toHaveBeenCalledWith(
      "WEBGL_INIT_FAILED",
      expect.stringContaining("コンパイル"),
    );
    unmount();

    const { gl: glNonError } = createMockWebGL2Context({
      throwNonErrorOnCreateShader: true,
    });
    const onFatalError2 = vi.fn();
    render(
      <ReaderCanvas
        slots={[
          {
            slot: { pageIndex: 0, position: "center" },
            frame: createReadyFrame(0, 1),
          },
        ]}
        getWebGL2Context={() => glNonError}
        onFatalError={onFatalError2}
      />,
    );
    expect(screen.getByTestId("reader-canvas")).toHaveAttribute(
      "data-webgl-status",
      "error",
    );
    expect(onFatalError2).toHaveBeenCalledWith(
      "WEBGL_INIT_FAILED",
      "WebGL2 描画の初期化に失敗しました",
    );
  });

  it("ResizeObserverとdevicePixelRatioに追従してバッファサイズと現在スロットを再描画すること (AC-GL-04)", () => {
    let observerCallback: ResizeObserverCallback | null = null;
    const disconnectSpy = vi.fn();
    const observeSpy = vi.fn();

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }
      observe = observeSpy;
      unobserve = vi.fn();
      disconnect = disconnectSpy;
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });

    const { gl, mocks } = createMockWebGL2Context();
    const slots: RenderSlotFrame[] = [
      {
        slot: { pageIndex: 1, position: "left" },
        frame: createReadyFrame(1, 1),
      },
      {
        slot: { pageIndex: 0, position: "right" },
        frame: createReadyFrame(0, 1),
      },
    ];

    const { unmount } = render(
      <ReaderCanvas slots={slots} getWebGL2Context={() => gl} />,
    );

    expect(observeSpy).toHaveBeenCalledTimes(1);
    mocks.viewport.mockClear();
    mocks.drawArrays.mockClear();

    act(() => {
      observerCallback?.(
        [
          {
            contentRect: { width: 500, height: 700 },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 1000, 1400);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(2);

    mocks.viewport.mockClear();
    mocks.drawArrays.mockClear();
    act(() => {
      observerCallback?.(
        [
          {
            contentRect: { width: 500, height: 700 },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });
    expect(mocks.viewport).not.toHaveBeenCalled();
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    const canvas = screen.getByTestId("reader-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      width: 600,
      height: 800,
      top: 0,
      left: 0,
      bottom: 800,
      right: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 0,
    });
    act(() => {
      observerCallback?.([], {} as ResizeObserver);
    });
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 600, 800);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(2);

    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("webglcontextlostでdispose前にnotifyContextLost()を同期呼び出しし、非同期タイル競合遮断とwebglcontextrestored自動再描画復帰を行うこと (AC-GL-05, AC-GL-07)", async () => {
    let observerCallback: ResizeObserverCallback | null = null;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    const pendingTile = createDeferred<ImageBitmap>();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => pendingTile.promise),
    );

    const notifySpy = vi.spyOn(
      WebGLRendererCoreModule.WebGLRendererCore.prototype,
      "notifyContextLost",
    );
    const disposeSpy = vi.spyOn(
      WebGLRendererCoreModule.WebGLRendererCore.prototype,
      "dispose",
    );

    const { gl, mocks } = createMockWebGL2Context({ maxTextureSize: 100 });
    const onRendererReady = vi.fn();
    const oversizedSlot: RenderSlotFrame = {
      slot: { pageIndex: 2, position: "center" },
      frame: createReadyFrame(2, 5, createFakeBitmap(200, 100)),
    };

    const { rerender, unmount } = render(
      <ReaderCanvas
        slots={[oversizedSlot]}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );

    const canvas = screen.getByTestId("reader-canvas");
    expect(canvas).toHaveAttribute("data-webgl-status", "ready");

    // 1. webglcontextlost 発火 -> dispose前に notifyContextLost() が同期呼び出しされる
    const lostEvent = new Event("webglcontextlost", { cancelable: true });
    act(() => {
      canvas.dispatchEvent(lostEvent);
    });

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(canvas).toHaveAttribute("data-webgl-status", "context-lost");
    expect(canvas).toHaveAttribute("data-rendered-page", "");
    expect(canvas).toHaveAttribute("data-rendered-pages", "");
    expect(canvas).toHaveAttribute("data-rendered-slots", "");
    expect(onRendererReady).toHaveBeenLastCalledWith(null);
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "webgl2",
          message: expect.stringContaining("ロスト"),
        }),
      ]),
    );

    // ロスト中に古い非同期タイルが解決してもキャンセル・破棄され、errorログや再描画は発生しない
    const staleTile = createFakeBitmap(100, 100);
    await act(async () => {
      pendingTile.resolve(staleTile);
      await flushMicrotasks();
    });
    expect(staleTile.close).toHaveBeenCalledTimes(1);
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(0);

    // ロスト中は ResizeObserver やスロット更新が描画をスキップすること
    mocks.drawArrays.mockClear();
    mocks.viewport.mockClear();
    act(() => {
      observerCallback?.(
        [{ contentRect: { width: 400, height: 600 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    rerender(
      <ReaderCanvas
        slots={[
          {
            slot: { pageIndex: 3, position: "left" },
            frame: createReadyFrame(3, 6, createFakeBitmap(80, 100)),
          },
          {
            slot: { pageIndex: 2, position: "right" },
            frame: createReadyFrame(2, 6, createFakeBitmap(80, 100)),
          },
        ]}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    // 2. webglcontextrestored 発火 -> 再初期化・現在スロット再描画・status=ready復帰
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    expect(canvas).toHaveAttribute("data-rendered-page", "2");
    expect(canvas).toHaveAttribute("data-rendered-pages", "2,3");
    expect(canvas).toHaveAttribute("data-rendered-slots", "left:3,right:2");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "6");
    expect(mocks.texImage2D).toHaveBeenCalled();
    expect(mocks.drawArrays).toHaveBeenCalledTimes(2);
    expect(onRendererReady).toHaveBeenLastCalledWith(
      expect.objectContaining({
        deletePageTexture: expect.any(Function),
        clearAllTextures: expect.any(Function),
      }),
    );

    unmount();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.invocationCallOrder[0]).toBeLessThan(
      disposeSpy.mock.invocationCallOrder[0],
    );
  });

  it("webglcontextrestored時の再初期化失敗でWEBGL_INIT_FAILEDを通知すること", () => {
    const { gl } = createMockWebGL2Context({ failOnSecondInit: true });
    const onFatalError = vi.fn();
    const onRendererReady = vi.fn();

    render(
      <ReaderCanvas
        slots={[
          {
            slot: { pageIndex: 0, position: "center" },
            frame: createReadyFrame(0, 1),
          },
        ]}
        getWebGL2Context={() => gl}
        onFatalError={onFatalError}
        onRendererReady={onRendererReady}
      />,
    );

    const canvas = screen.getByTestId("reader-canvas");
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    expect(canvas).toHaveAttribute("data-webgl-status", "error");
    expect(onFatalError).toHaveBeenCalledWith(
      "WEBGL_INIT_FAILED",
      "再初期化失敗",
    );
    expect(onRendererReady).toHaveBeenLastCalledWith(null);
  });

  it("window.matchMediaでDPR単独変化を追従してviewport更新と現在スロット再描画を行い、コンテキストロスト中はスキップしアンマウント時に解除すること (AC-GL-04)", () => {
    interface MockMediaQueryEntry {
      listeners: Set<() => void>;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    }

    const mediaQueryEntries = new Map<string, MockMediaQueryEntry>();
    const matchMediaMock = vi.fn((query: string) => {
      let entry = mediaQueryEntries.get(query);
      if (!entry) {
        const listeners = new Set<() => void>();
        entry = {
          listeners,
          addEventListener: vi.fn(
            (type: string, listener: EventListenerOrEventListenerObject) => {
              if (type === "change" && typeof listener === "function") {
                listeners.add(listener as () => void);
              }
            },
          ),
          removeEventListener: vi.fn(
            (type: string, listener: EventListenerOrEventListenerObject) => {
              if (type === "change" && typeof listener === "function") {
                listeners.delete(listener as () => void);
              }
            },
          ),
        };
        mediaQueryEntries.set(query, entry);
      }

      return {
        media: query,
        matches: true,
        onchange: null,
        addEventListener: entry.addEventListener,
        removeEventListener: entry.removeEventListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      } as unknown as MediaQueryList;
    });

    vi.stubGlobal("matchMedia", matchMediaMock);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1,
    });

    const { gl, mocks } = createMockWebGL2Context();
    const frame0 = createReadyFrame(0, 1);

    const { unmount } = render(
      <ReaderCanvas
        slots={[{ slot: { pageIndex: 0, position: "center" }, frame: frame0 }]}
        getWebGL2Context={() => gl}
      />,
    );

    const canvas = screen.getByTestId("reader-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    expect(matchMediaMock).toHaveBeenCalledWith("(resolution: 1dppx)");
    const dpr1Entry = mediaQueryEntries.get("(resolution: 1dppx)");
    expect(dpr1Entry?.listeners.size).toBe(1);

    mocks.viewport.mockClear();
    mocks.drawArrays.mockClear();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });

    act(() => {
      for (const listener of [...(dpr1Entry?.listeners ?? [])]) {
        listener();
      }
    });

    expect(dpr1Entry?.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(matchMediaMock).toHaveBeenCalledWith("(resolution: 2dppx)");
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 800, 1200);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);

    const dpr2Entry = mediaQueryEntries.get("(resolution: 2dppx)");
    mocks.viewport.mockClear();
    mocks.drawArrays.mockClear();
    act(() => {
      for (const listener of [...(dpr2Entry?.listeners ?? [])]) {
        listener();
      }
    });
    expect(mocks.viewport).not.toHaveBeenCalled();
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    act(() => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    mocks.viewport.mockClear();
    mocks.drawArrays.mockClear();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1.5,
    });
    act(() => {
      for (const listener of [...(dpr2Entry?.listeners ?? [])]) {
        listener();
      }
    });
    expect(mocks.viewport).not.toHaveBeenCalled();
    expect(mocks.drawArrays).not.toHaveBeenCalled();
    expect(matchMediaMock).toHaveBeenCalledWith("(resolution: 1.5dppx)");

    const dpr15Entry = mediaQueryEntries.get("(resolution: 1.5dppx)");
    expect(dpr15Entry?.listeners.size).toBe(1);
    unmount();
    expect(dpr15Entry?.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(dpr15Entry?.listeners.size).toBe(0);
  });
});

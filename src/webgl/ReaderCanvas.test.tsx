import { composeStories } from "@storybook/react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DecodedPageFrame } from "../engine/types";
import { ReaderCanvas, type ReaderCanvasHandle } from "./ReaderCanvas";
import * as stories from "./ReaderCanvas.stories";

const { Default, UnsupportedEnvironment } = composeStories(stories);

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

interface MockCanvasGLOptions {
  failCompile?: boolean;
  throwNonErrorOnCreateShader?: boolean;
  failOnSecondInit?: boolean;
}

function createMockWebGL2Context(options: MockCanvasGLOptions = {}) {
  let shaderInitCount = 0;
  let textureSeq = 0;
  const canvasState = { width: 300, height: 150 };

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    MAX_VIEWPORT_DIMS: 0x0d3a,
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
    getUniformLocation: vi.fn(() => ({}) as WebGLUniformLocation),
    createVertexArray: vi.fn(() => ({}) as WebGLVertexArrayObject),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    createBuffer: vi.fn(() => ({}) as WebGLBuffer),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getParameter: vi.fn(() => new Int32Array([4096, 4096])),
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

  it("DefaultおよびUnsupportedEnvironmentストーリーを描画できること", () => {
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);

    const { unmount } = render(<Default />);
    const defaultCanvas = screen.getByTestId("reader-canvas");
    expect(defaultCanvas).toHaveAttribute("data-webgl-status", "error");
    expect(defaultCanvas).toHaveAttribute("data-rendered-page", "");
    expect(defaultCanvas).toHaveAttribute("data-rendered-epoch", "");
    expect(getContextSpy).toHaveBeenCalledWith(
      "webgl2",
      expect.objectContaining({ alpha: false }),
    );
    unmount();

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

  it("WebGL2初期化成功時にフレーム描画・ハンドル操作・破棄を行えること (AC-GL-02, AC-GL-03)", () => {
    const { gl, mocks } = createMockWebGL2Context();
    const handleRef: { current: ReaderCanvasHandle | null } = { current: null };
    const onRendererReady = vi.fn((handle: ReaderCanvasHandle | null) => {
      handleRef.current = handle;
    });

    const { rerender, unmount } = render(
      <Default getWebGL2Context={() => gl} onRendererReady={onRendererReady} />,
    );

    const canvas = screen.getByTestId("reader-canvas");
    expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    expect(canvas).toHaveAttribute("data-rendered-page", "");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "");
    expect(handleRef.current).not.toBeNull();

    // ready フレームを描画すると属性と WebGL 描画が更新される
    const frame0 = createReadyFrame(0, 1);
    rerender(
      <ReaderCanvas
        frame={frame0}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(canvas).toHaveAttribute("data-rendered-page", "0");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "1");
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);

    // 公開ハンドル経由で個別テクスチャ破棄と全テクスチャ破棄を実行できる
    handleRef.current?.deletePageTexture(0);
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(1);

    const frame1 = createReadyFrame(1, 2);
    rerender(
      <ReaderCanvas
        frame={frame1}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    handleRef.current?.clearAllTextures();
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(2);

    // error フレーム時はページ表示属性を空に戻す
    rerender(
      <ReaderCanvas
        frame={{
          status: "error",
          pageIndex: 2,
          epoch: 3,
          errorCode: "DECODE_FAILED",
          message: "decode failed",
        }}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(canvas).toHaveAttribute("data-rendered-page", "");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "");

    // アンマウント時にハンドルを null 通知し、renderer を dispose する
    unmount();
    expect(onRendererReady).toHaveBeenLastCalledWith(null);
    expect(mocks.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it("WebGLRendererCore初期化失敗時にWEBGL_INIT_FAILEDを通知すること（Errorおよび非Error送出含む）", () => {
    const { gl: glFailCompile } = createMockWebGL2Context({
      failCompile: true,
    });
    const onFatalError = vi.fn();
    const onRendererReady = vi.fn();

    const { unmount } = render(
      <ReaderCanvas
        frame={null}
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

    // 非 Error 例外フォールバックとコールバック省略時にもクラッシュしないこと
    const { gl: glNonError } = createMockWebGL2Context({
      throwNonErrorOnCreateShader: true,
    });
    const onFatalError2 = vi.fn();
    render(
      <ReaderCanvas
        frame={createReadyFrame(0, 1)}
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

  it("ResizeObserverとdevicePixelRatioに追従してバッファサイズと現在フレームを再描画すること (AC-GL-04)", () => {
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
    const frame0 = createReadyFrame(0, 1);

    const { unmount } = render(
      <ReaderCanvas frame={frame0} getWebGL2Context={() => gl} />,
    );

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(observerCallback).not.toBeNull();
    mocks.viewport.mockClear();
    mocks.drawArrays.mockClear();

    // contentRect 更新でリサイズ＋現在フレーム再描画が走る
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
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);

    // 同一サイズでは重複描画しない
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

    // 空 entries 時は getBoundingClientRect() + DPR <= 0 のフォールバックを使用
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
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);

    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("webglcontextlostでpreventDefaultと警告ログ記録を行いwebglcontextrestoredで自動再描画復帰すること (AC-GL-05)", () => {
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

    const { gl, mocks } = createMockWebGL2Context();
    const onRendererReady = vi.fn();
    const frame2 = createReadyFrame(2, 5);

    const { rerender } = render(
      <ReaderCanvas
        frame={frame2}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );

    const canvas = screen.getByTestId("reader-canvas");
    expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    expect(canvas).toHaveAttribute("data-rendered-page", "2");

    // 1. webglcontextlost 発火
    const lostEvent = new Event("webglcontextlost", { cancelable: true });
    act(() => {
      canvas.dispatchEvent(lostEvent);
    });

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(canvas).toHaveAttribute("data-webgl-status", "context-lost");
    expect(canvas).toHaveAttribute("data-rendered-page", "");
    expect(onRendererReady).toHaveBeenLastCalledWith(null);
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "webgl2",
        }),
      ]),
    );

    // ロスト中は ResizeObserver やフレーム更新が描画をスキップすること
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
        frame={createReadyFrame(3, 6)}
        getWebGL2Context={() => gl}
        onRendererReady={onRendererReady}
      />,
    );
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    // 2. webglcontextrestored 発火 -> 再初期化・現在フレーム再描画・status=ready復帰
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    expect(canvas).toHaveAttribute("data-rendered-page", "3");
    expect(canvas).toHaveAttribute("data-rendered-epoch", "6");
    expect(mocks.texImage2D).toHaveBeenCalled();
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);
    expect(onRendererReady).toHaveBeenLastCalledWith(
      expect.objectContaining({
        deletePageTexture: expect.any(Function),
        clearAllTextures: expect.any(Function),
      }),
    );
  });

  it("webglcontextrestored時の再初期化失敗でWEBGL_INIT_FAILEDを通知すること", () => {
    const { gl } = createMockWebGL2Context({ failOnSecondInit: true });
    const onFatalError = vi.fn();
    const onRendererReady = vi.fn();

    render(
      <ReaderCanvas
        frame={createReadyFrame(0, 1)}
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
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DecodedPageFrame } from "../engine/types";
import {
  WebGLInitError,
  WebGLRendererCore,
  clampViewportDimensions,
  computeAspectFitScale,
} from "./WebGLRendererCore";
import type { RenderSlotFrame } from "./types";

function createFakeBitmap(width = 800, height = 1200): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function createReadyFrame(
  pageIndex: number,
  bitmap = createFakeBitmap(),
  epoch = 1,
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
  epoch = 1,
): Extract<DecodedPageFrame, { status: "error" }> {
  return {
    status: "error",
    pageIndex,
    epoch,
    errorCode: "DECODE_FAILED",
    message: `page ${pageIndex} error`,
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

interface MockGLOverrides {
  canvasWidth?: number;
  canvasHeight?: number;
  maxViewportDims?: ArrayLike<number> | null;
  maxTextureSize?: unknown;
  omitIsContextLost?: boolean;
  isContextLost?: () => boolean;
  createShader?: (type: number) => WebGLShader | null;
  compileStatus?: (shader: WebGLShader) => boolean;
  shaderInfoLog?: string | null;
  createProgram?: () => WebGLProgram | null;
  linkStatus?: boolean;
  programInfoLog?: string | null;
  attribLocations?: Record<string, number>;
  uniformLocations?: Record<string, WebGLUniformLocation | null>;
  createVertexArray?: () => WebGLVertexArrayObject | null;
  createBuffer?: () => WebGLBuffer | null;
  createTexture?: () => WebGLTexture | null;
  onTexImage2D?: () => void;
}

function createMockWebGL2Context(overrides: MockGLOverrides = {}) {
  let shaderSeq = 0;
  let programSeq = 0;
  let vaoSeq = 0;
  let bufferSeq = 0;
  let textureSeq = 0;
  const shaderTypes = new Map<WebGLShader, number>();

  const canvas = {
    width: overrides.canvasWidth ?? 300,
    height: overrides.canvasHeight ?? 150,
  };

  const gl: Record<string, unknown> = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    MAX_VIEWPORT_DIMS: 0x0d3a,
    MAX_TEXTURE_SIZE: 0x0d33,
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
    canvas,
    createShader: vi.fn((type: number) => {
      if (overrides.createShader) {
        return overrides.createShader(type);
      }
      shaderSeq += 1;
      const shader = { id: shaderSeq, type } as unknown as WebGLShader;
      shaderTypes.set(shader, type);
      return shader;
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn((shader: WebGLShader, pname: number) => {
      if (pname === 0x8b81 && overrides.compileStatus) {
        return overrides.compileStatus(shader);
      }
      return true;
    }),
    getShaderInfoLog: vi.fn(() =>
      overrides.shaderInfoLog !== undefined
        ? overrides.shaderInfoLog
        : "shader compile failed",
    ),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => {
      if (overrides.createProgram) {
        return overrides.createProgram();
      }
      programSeq += 1;
      return { id: programSeq } as unknown as WebGLProgram;
    }),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn((_program: WebGLProgram, pname: number) => {
      if (pname === 0x8b82 && overrides.linkStatus !== undefined) {
        return overrides.linkStatus;
      }
      return true;
    }),
    getProgramInfoLog: vi.fn(() =>
      overrides.programInfoLog !== undefined
        ? overrides.programInfoLog
        : "program link failed",
    ),
    deleteProgram: vi.fn(),
    getAttribLocation: vi.fn((_program: WebGLProgram, name: string) => {
      if (overrides.attribLocations && name in overrides.attribLocations) {
        return overrides.attribLocations[name]!;
      }
      return name === "a_position" ? 0 : 1;
    }),
    getUniformLocation: vi.fn((_program: WebGLProgram, name: string) => {
      if (overrides.uniformLocations && name in overrides.uniformLocations) {
        return overrides.uniformLocations[name]!;
      }
      return { name } as unknown as WebGLUniformLocation;
    }),
    createVertexArray: vi.fn(() => {
      if (overrides.createVertexArray) {
        return overrides.createVertexArray();
      }
      vaoSeq += 1;
      return { id: vaoSeq } as unknown as WebGLVertexArrayObject;
    }),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    createBuffer: vi.fn(() => {
      if (overrides.createBuffer) {
        return overrides.createBuffer();
      }
      bufferSeq += 1;
      return { id: bufferSeq } as unknown as WebGLBuffer;
    }),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getParameter: vi.fn((pname: number) => {
      if (pname === 0x0d3a) {
        return overrides.maxViewportDims !== undefined
          ? overrides.maxViewportDims
          : new Int32Array([4096, 4096]);
      }
      if (pname === 0x0d33) {
        return overrides.maxTextureSize !== undefined
          ? overrides.maxTextureSize
          : 4096;
      }
      return null;
    }),
    clearColor: vi.fn(),
    clear: vi.fn(),
    viewport: vi.fn(),
    createTexture: vi.fn(() => {
      if (overrides.createTexture) {
        return overrides.createTexture();
      }
      textureSeq += 1;
      return { id: textureSeq } as unknown as WebGLTexture;
    }),
    deleteTexture: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(() => {
      overrides.onTexImage2D?.();
    }),
    generateMipmap: vi.fn(),
    texParameteri: vi.fn(),
    useProgram: vi.fn(),
    uniform2f: vi.fn(),
    uniform1i: vi.fn(),
    drawArrays: vi.fn(),
  };

  if (!overrides.omitIsContextLost) {
    gl.isContextLost = vi.fn(() =>
      overrides.isContextLost ? overrides.isContextLost() : false,
    );
  }

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    mocks: gl as Record<string, ReturnType<typeof vi.fn>> & {
      canvas: typeof canvas;
      TEXTURE_2D: number;
      UNPACK_ALIGNMENT: number;
      RGBA: number;
      UNSIGNED_BYTE: number;
      TEXTURE_MIN_FILTER: number;
      TEXTURE_MAG_FILTER: number;
      TEXTURE_WRAP_S: number;
      TEXTURE_WRAP_T: number;
      LINEAR_MIPMAP_LINEAR: number;
      LINEAR: number;
      CLAMP_TO_EDGE: number;
      TRIANGLE_STRIP: number;
      COLOR_BUFFER_BIT: number;
    },
    shaderTypes,
  };
}

describe("computeAspectFitScale", () => {
  it("画像とビューポートのアスペクト比に応じて中央内接スケールを計算すること (AC-GL-02)", () => {
    const [sx1, sy1] = computeAspectFitScale(800, 1200, 1200, 1200);
    expect(sx1).toBeCloseTo(2 / 3);
    expect(sy1).toBe(1);

    const [sx2, sy2] = computeAspectFitScale(1600, 800, 1000, 1000);
    expect(sx2).toBe(1);
    expect(sy2).toBeCloseTo(0.5);

    expect(computeAspectFitScale(800, 1200, 400, 600)).toEqual([1, 1]);
  });

  it("0以下や非有限のサイズ入力に対して安全なフォールバック[1, 1]を返すこと", () => {
    expect(computeAspectFitScale(0, 1200, 800, 600)).toEqual([1, 1]);
    expect(computeAspectFitScale(800, -10, 800, 600)).toEqual([1, 1]);
    expect(computeAspectFitScale(800, 1200, 0, 600)).toEqual([1, 1]);
    expect(computeAspectFitScale(800, 1200, 800, Number.NaN)).toEqual([1, 1]);
  });
});

describe("clampViewportDimensions", () => {
  it("CSSサイズとDPRを乗算しMAX_VIEWPORT_DIMS超過時はアスペクト比を維持してクランプすること (AC-GL-04)", () => {
    expect(clampViewportDimensions(400, 600, 2, [4096, 4096])).toEqual({
      width: 800,
      height: 1200,
    });

    expect(clampViewportDimensions(3000, 2000, 2, [4096, 4096])).toEqual({
      width: 4096,
      height: 2730,
    });

    expect(clampViewportDimensions(1000, 3000, 2, [4096, 4096])).toEqual({
      width: 1365,
      height: 4096,
    });
  });

  it("0以下・非有限値・無効なMAX_VIEWPORT_DIMSに対して最小1へ安全にクランプすること", () => {
    expect(clampViewportDimensions(0, -20, 0, [4096, 4096])).toEqual({
      width: 1,
      height: 1,
    });

    expect(clampViewportDimensions(0.1, 0.2, Number.NaN, [4096, 4096])).toEqual(
      {
        width: 1,
        height: 1,
      },
    );

    expect(clampViewportDimensions(800, 600, 1, null)).toEqual({
      width: 800,
      height: 600,
    });

    expect(clampViewportDimensions(800, 600, 1, [0, -1])).toEqual({
      width: 800,
      height: 600,
    });
  });
});

describe("WebGLRendererCore", () => {
  beforeEach(() => {
    diagnosticLogger.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("WebGLInitErrorがWEBGL_INIT_FAILEDコードと任意causeを保持すること", () => {
    const err1 = new WebGLInitError("初期化失敗");
    expect(err1.name).toBe("WebGLInitError");
    expect(err1.code).toBe("WEBGL_INIT_FAILED");
    expect(err1.cause).toBeUndefined();

    const rootCause = new Error("root");
    const err2 = new WebGLInitError("詳細失敗", rootCause);
    expect(err2.cause).toBe(rootCause);
  });

  it("シェーダー・プログラム・ロケーション・VAO/VBO生成失敗時にリソースを解放してWebGLInitErrorを送出すること", () => {
    const { gl: gl1 } = createMockWebGL2Context({
      createShader: () => null,
    });
    expect(() => new WebGLRendererCore(gl1)).toThrow(WebGLInitError);

    const { gl: gl2, mocks: m2 } = createMockWebGL2Context({
      compileStatus: () => false,
      shaderInfoLog: null,
    });
    expect(() => new WebGLRendererCore(gl2)).toThrow(WebGLInitError);
    expect(m2.deleteShader).toHaveBeenCalledTimes(1);

    const { gl: gl3, mocks: m3 } = createMockWebGL2Context({
      createShader: (type) =>
        type === 0x8b31 ? ({ id: 1 } as unknown as WebGLShader) : null,
    });
    expect(() => new WebGLRendererCore(gl3)).toThrow(WebGLInitError);
    expect(m3.deleteShader).toHaveBeenCalledTimes(1);

    const {
      gl: gl4,
      mocks: m4,
      shaderTypes: st4,
    } = createMockWebGL2Context({
      compileStatus: (shader) => st4.get(shader) === 0x8b31,
    });
    expect(() => new WebGLRendererCore(gl4)).toThrow(WebGLInitError);
    expect(m4.deleteShader).toHaveBeenCalledTimes(2);

    const { gl: gl5, mocks: m5 } = createMockWebGL2Context({
      createProgram: () => null,
    });
    expect(() => new WebGLRendererCore(gl5)).toThrow(WebGLInitError);
    expect(m5.deleteShader).toHaveBeenCalledTimes(2);

    const { gl: gl6, mocks: m6 } = createMockWebGL2Context({
      linkStatus: false,
      programInfoLog: null,
    });
    expect(() => new WebGLRendererCore(gl6)).toThrow(WebGLInitError);
    expect(m6.deleteProgram).toHaveBeenCalledTimes(1);
    expect(m6.deleteShader).toHaveBeenCalledTimes(2);

    const badLocationCases: MockGLOverrides[] = [
      { attribLocations: { a_position: -1 } },
      { attribLocations: { a_texCoord: -1 } },
      { uniformLocations: { u_scale: null } },
      { uniformLocations: { u_offset: null } },
      { uniformLocations: { u_texture: null } },
    ];
    for (const badOverrides of badLocationCases) {
      const { gl: glLoc, mocks: mLoc } = createMockWebGL2Context(badOverrides);
      expect(() => new WebGLRendererCore(glLoc)).toThrow(WebGLInitError);
      expect(mLoc.deleteProgram).toHaveBeenCalledTimes(1);
      expect(mLoc.deleteShader).toHaveBeenCalledTimes(2);
    }

    const { gl: gl8, mocks: m8 } = createMockWebGL2Context({
      createVertexArray: () => null,
    });
    expect(() => new WebGLRendererCore(gl8)).toThrow(WebGLInitError);
    expect(m8.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(m8.deleteVertexArray).not.toHaveBeenCalled();
    expect(m8.deleteProgram).toHaveBeenCalledTimes(1);

    const { gl: gl9, mocks: m9 } = createMockWebGL2Context({
      createBuffer: () => null,
    });
    expect(() => new WebGLRendererCore(gl9)).toThrow(WebGLInitError);
    expect(m9.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(m9.deleteBuffer).not.toHaveBeenCalled();
    expect(m9.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it("MAX_TEXTURE_SIZEを取得・正規化してgetMaxTextureSizeで公開し不正値時は安全デフォルト4096を用いること (AC-GL-07)", () => {
    const { gl: glValid } = createMockWebGL2Context({ maxTextureSize: 8192.9 });
    const rendererValid = new WebGLRendererCore(glValid);
    expect(rendererValid.getMaxTextureSize()).toBe(8192);

    const invalidValues: unknown[] = [
      null,
      0,
      -512,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "4096",
    ];
    for (const invalidValue of invalidValues) {
      const { gl: glInvalid } = createMockWebGL2Context({
        maxTextureSize: invalidValue,
      });
      const rendererInvalid = new WebGLRendererCore(glInvalid);
      expect(rendererInvalid.getMaxTextureSize()).toBe(4096);
    }
  });

  it("resizeが実変更時のみcanvasサイズとgl.viewportを更新すること (AC-GL-04)", () => {
    const { gl, mocks } = createMockWebGL2Context({
      canvasWidth: 300,
      canvasHeight: 150,
    });
    const renderer = new WebGLRendererCore(gl);

    expect(renderer.resize(300, 150, 1)).toBe(true);
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 300, 150);

    mocks.viewport.mockClear();
    expect(renderer.resize(300, 150, 1)).toBe(false);
    expect(mocks.viewport).not.toHaveBeenCalled();

    expect(renderer.resize(800, 600, 2)).toBe(true);
    expect(mocks.canvas.width).toBe(1600);
    expect(mocks.canvas.height).toBe(1200);
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 1600, 1200);

    expect(renderer.resize(800, 500, 2)).toBe(true);
    expect(mocks.canvas.width).toBe(1600);
    expect(mocks.canvas.height).toBe(1000);
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 1600, 1000);
  });

  it("renderFrameが純黒クリア・UNPACK_ALIGNMENT=1・generateMipmap・LINEAR_MIPMAP_LINEAR・u_offset=[0,0]で単一描画を行うこと (AC-GL-02, AC-GL-03)", () => {
    const { gl, mocks } = createMockWebGL2Context({
      canvasWidth: 1000,
      canvasHeight: 1000,
    });
    const renderer = new WebGLRendererCore(gl);

    renderer.renderFrame(null);
    expect(mocks.clearColor).toHaveBeenCalledWith(0, 0, 0, 1);
    expect(mocks.clear).toHaveBeenCalledWith(mocks.COLOR_BUFFER_BIT);
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    renderer.renderFrame(createErrorFrame(0));
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    renderer.resize(1200, 1200, 1);
    const bitmap0 = createFakeBitmap(800, 1200);
    const frame0 = createReadyFrame(0, bitmap0);
    renderer.renderFrame(frame0);

    expect(mocks.pixelStorei).toHaveBeenCalledWith(mocks.UNPACK_ALIGNMENT, 1);
    expect(mocks.texImage2D).toHaveBeenCalledWith(
      mocks.TEXTURE_2D,
      0,
      mocks.RGBA,
      mocks.RGBA,
      mocks.UNSIGNED_BYTE,
      bitmap0,
    );
    expect(mocks.generateMipmap).toHaveBeenCalledWith(mocks.TEXTURE_2D);
    expect(mocks.texParameteri).toHaveBeenCalledWith(
      mocks.TEXTURE_2D,
      mocks.TEXTURE_MIN_FILTER,
      mocks.LINEAR_MIPMAP_LINEAR,
    );
    expect(mocks.texParameteri).toHaveBeenCalledWith(
      mocks.TEXTURE_2D,
      mocks.TEXTURE_MAG_FILTER,
      mocks.LINEAR,
    );
    expect(mocks.texParameteri).toHaveBeenCalledWith(
      mocks.TEXTURE_2D,
      mocks.TEXTURE_WRAP_S,
      mocks.CLAMP_TO_EDGE,
    );
    expect(mocks.texParameteri).toHaveBeenCalledWith(
      mocks.TEXTURE_2D,
      mocks.TEXTURE_WRAP_T,
      mocks.CLAMP_TO_EDGE,
    );
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_scale" }),
      expect.closeTo(2 / 3, 5),
      1,
    );
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_offset" }),
      0,
      0,
    );
    expect(mocks.uniform1i).toHaveBeenCalledWith(expect.anything(), 0);
    expect(mocks.drawArrays).toHaveBeenCalledWith(mocks.TRIANGLE_STRIP, 0, 4);

    // 同一 bitmap での再描画はテクスチャを再利用して再転送しない
    mocks.texImage2D.mockClear();
    mocks.generateMipmap.mockClear();
    renderer.renderFrame(frame0);
    expect(mocks.texImage2D).not.toHaveBeenCalled();
    expect(mocks.generateMipmap).not.toHaveBeenCalled();
    expect(mocks.drawArrays).toHaveBeenCalledTimes(2);

    // 同一 pageIndex へ別 bitmap を描画すると旧テクスチャを解放して再アップロードする
    const bitmap0Next = createFakeBitmap(800, 1200);
    renderer.renderFrame(createReadyFrame(0, bitmap0Next));
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(1);
    expect(mocks.texImage2D).toHaveBeenCalledTimes(1);
    expect(mocks.generateMipmap).toHaveBeenCalledTimes(1);
  });

  it("createTextureがnullを返した場合も安全に中断すること", () => {
    const { gl, mocks } = createMockWebGL2Context({
      createTexture: () => null,
    });
    const renderer = new WebGLRendererCore(gl);

    expect(
      renderer.renderSlots([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: createReadyFrame(0),
        },
      ]),
    ).toEqual([]);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.drawArrays).not.toHaveBeenCalled();
  });

  it("renderSlotsが2スロット見開きで高さ揃え背表紙密着フィット描画・片側欠損時半面背表紙寄せ描画を行うこと (AC-GL-08)", () => {
    const { gl, mocks } = createMockWebGL2Context({
      canvasWidth: 1600,
      canvasHeight: 1200,
    });
    const renderer = new WebGLRendererCore(gl);
    renderer.resize(1600, 1200, 1);

    // 空スロット配列は黒クリアのみ
    expect(renderer.renderSlots([])).toEqual([]);
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    // 1. 両側 ready（左右非対称寸法: 左 600x1200 [normW=0.5], 右 900x1200 [normW=0.75]）
    // ビューポート 1250x1000 (aspect=1.25 = 0.5+0.75) -> 左 [-1, -0.2], 右 [-0.2, +1] で隙間ゼロ・高さ1.0
    renderer.resize(1250, 1000, 1);
    const leftBitmap = createFakeBitmap(600, 1200);
    const rightBitmap = createFakeBitmap(900, 1200);
    const twoSlots: RenderSlotFrame[] = [
      {
        slot: { pageIndex: 2, position: "left" },
        frame: createReadyFrame(2, leftBitmap),
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: createReadyFrame(1, rightBitmap),
      },
    ];
    mocks.uniform2f.mockClear();
    mocks.drawArrays.mockClear();

    const renderedTwo = renderer.renderSlots(twoSlots);
    expect(renderedTwo).toEqual([
      { pageIndex: 2, position: "left" },
      { pageIndex: 1, position: "right" },
    ]);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(2);
    // 左スロット scale=(0.4, 1), offset=(-0.6, 0) -> x範囲 [-1.0, -0.2]
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_scale" }),
      expect.closeTo(0.4, 5),
      expect.closeTo(1, 5),
    );
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_offset" }),
      expect.closeTo(-0.6, 5),
      expect.closeTo(0, 5),
    );
    // 右スロット scale=(0.6, 1), offset=(0.4, 0) -> x範囲 [-0.2, 1.0]
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_scale" }),
      expect.closeTo(0.6, 5),
      expect.closeTo(1, 5),
    );
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_offset" }),
      expect.closeTo(0.4, 5),
      expect.closeTo(0, 5),
    );

    // 2. 片側 error（右が error・左が ready）-> 左半画面 [-1, 0] の背表紙 x=0 寄せ
    renderer.resize(1200, 800, 1); // 半画面 600x800 (aspect=0.75)
    mocks.uniform2f.mockClear();
    mocks.drawArrays.mockClear();
    const leftOnlyResult = renderer.renderSlots([
      {
        slot: { pageIndex: 2, position: "left" },
        frame: createReadyFrame(2, createFakeBitmap(800, 1200)), // aspect=2/3 -> halfScaleX=8/9
      },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: createErrorFrame(1),
      },
    ]);
    expect(leftOnlyResult).toEqual([{ pageIndex: 2, position: "left" }]);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_scale" }),
      expect.closeTo(4 / 9, 5),
      expect.closeTo(1, 5),
    );
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_offset" }),
      expect.closeTo(-4 / 9, 5),
      expect.closeTo(0, 5),
    );

    // 3. 左が null・右が ready -> 右半画面 [0, 1] の背表紙 x=0 寄せ（縦長狭い画面 800x1200）
    renderer.resize(800, 1200, 1); // 半画面 400x1200 (aspect=1/3), 画像 800x1200 (aspect=2/3) -> halfScaleX=1, halfScaleY=0.5
    mocks.uniform2f.mockClear();
    mocks.drawArrays.mockClear();
    const rightOnlyResult = renderer.renderSlots([
      { slot: { pageIndex: 2, position: "left" }, frame: null },
      {
        slot: { pageIndex: 1, position: "right" },
        frame: createReadyFrame(1, createFakeBitmap(800, 1200)),
      },
    ]);
    expect(rightOnlyResult).toEqual([{ pageIndex: 1, position: "right" }]);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_scale" }),
      expect.closeTo(0.5, 5),
      expect.closeTo(0.5, 5),
    );
    expect(mocks.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: "u_offset" }),
      expect.closeTo(0.5, 5),
      expect.closeTo(0, 5),
    );

    // 4. 両側とも null/error -> 空配列
    expect(
      renderer.renderSlots([
        {
          slot: { pageIndex: 2, position: "left" },
          frame: createErrorFrame(2),
        },
        { slot: { pageIndex: 1, position: "right" }, frame: null },
      ]),
    ).toEqual([]);

    // 5. 単スロットに left / right を渡した場合も半画面描画・異常寸法フォールバックもクラッシュしない
    expect(
      renderer.renderSlots([
        {
          slot: { pageIndex: 3, position: "left" },
          frame: createReadyFrame(3, createFakeBitmap(800, 1200)),
        },
      ]),
    ).toEqual([{ pageIndex: 3, position: "left" }]);

    expect(
      renderer.renderSlots([
        {
          slot: { pageIndex: 4, position: "left" },
          frame: {
            status: "ready",
            pageIndex: 4,
            epoch: 1,
            width: 0,
            height: 100,
            bitmap: createFakeBitmap(100, 100),
          },
        },
        {
          slot: { pageIndex: 5, position: "right" },
          frame: {
            status: "ready",
            pageIndex: 5,
            epoch: 1,
            width: 100,
            height: 0,
            bitmap: createFakeBitmap(100, 100),
          },
        },
      ]),
    ).toEqual([
      { pageIndex: 4, position: "left" },
      { pageIndex: 5, position: "right" },
    ]);

    // 6. 2要素とも center のような非標準入力でも安全にフォールバック処理すること
    expect(
      renderer.renderSlots([
        {
          slot: { pageIndex: 6, position: "center" },
          frame: createReadyFrame(6, createFakeBitmap(800, 1200)),
        },
        {
          slot: { pageIndex: 7, position: "center" },
          frame: createReadyFrame(7, createFakeBitmap(800, 1200)),
        },
      ]),
    ).toEqual([{ pageIndex: 6, position: "center" }]);
  });

  it("MAX_TEXTURE_SIZE超過画像を非同期タイル分割し一時bitmap.close()・連続描画・片側待機結合配置維持を実行すること (AC-GL-07, AC-GL-08)", async () => {
    const croppedBitmaps: ImageBitmap[] = [];
    const cropCalls: Array<{
      sx: number;
      sy: number;
      sw: number;
      sh: number;
    }> = [];
    const createImageBitmapMock = vi.fn(
      async (
        _source: ImageBitmap,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
      ) => {
        cropCalls.push({ sx, sy, sw, sh });
        const tile = createFakeBitmap(sw, sh);
        croppedBitmaps.push(tile);
        return tile;
      },
    );
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);

    const { gl, mocks } = createMockWebGL2Context({
      canvasWidth: 1000,
      canvasHeight: 1000,
      maxTextureSize: 100,
    });
    const readyCallback = vi.fn();
    const renderer = new WebGLRendererCore(gl, {
      onAsyncTextureReady: readyCallback,
    });
    renderer.resize(1000, 1000, 1);

    // 左スロット: 通常 (50x100), 右スロット: 超過 (150x120 -> 2x2=4タイル)
    const normalLeftBitmap = createFakeBitmap(50, 100);
    const oversizedRightBitmap = createFakeBitmap(150, 120);
    const slots: RenderSlotFrame[] = [
      {
        slot: { pageIndex: 1, position: "left" },
        frame: createReadyFrame(1, normalLeftBitmap),
      },
      {
        slot: { pageIndex: 0, position: "right" },
        frame: createReadyFrame(0, oversizedRightBitmap),
      },
    ];

    // 初回描画: 右は非同期準備中のため左のみ完了。ただし結合配置 (normW_L=0.5, normW_R=1.25 -> combined=1.75) を維持！
    const firstResult = renderer.renderSlots(slots);
    expect(firstResult).toEqual([{ pageIndex: 1, position: "left" }]);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(1);
    const leftScaleCall = mocks.uniform2f.mock.calls.find(
      (call) => (call[0] as { name: string }).name === "u_scale",
    );
    expect(leftScaleCall?.[1]).toBeCloseTo(0.5 / 1.75, 5);

    // 準備中の再呼出で warn ログおよび createImageBitmap が重複発火しないこと
    renderer.renderSlots(slots);
    const warns = diagnosticLogger
      .getEntries()
      .filter((e) => e.level === "warn" && e.scope === "webgl2");
    expect(warns).toHaveLength(1);

    await flushMicrotasks();

    expect(cropCalls).toEqual([
      { sx: 0, sy: 0, sw: 100, sh: 100 },
      { sx: 100, sy: 0, sw: 50, sh: 100 },
      { sx: 0, sy: 100, sw: 100, sh: 20 },
      { sx: 100, sy: 100, sw: 50, sh: 20 },
    ]);
    expect(croppedBitmaps).toHaveLength(4);
    for (const tileBitmap of croppedBitmaps) {
      expect(tileBitmap.close).toHaveBeenCalledTimes(1);
    }
    expect(readyCallback).toHaveBeenCalledWith(0);

    // 再描画で左・右双方描画され、右は4タイル分 drawArrays される（計 1 + 4 = 5 回）
    mocks.drawArrays.mockClear();
    mocks.uniform2f.mockClear();
    const secondResult = renderer.renderSlots(slots);
    expect(secondResult).toEqual([
      { pageIndex: 1, position: "left" },
      { pageIndex: 0, position: "right" },
    ]);
    expect(mocks.drawArrays).toHaveBeenCalledTimes(5);

    // 同一座標系（左の u_scale が初回と一致）
    const secondLeftScaleCall = mocks.uniform2f.mock.calls.find(
      (call) => (call[0] as { name: string }).name === "u_scale",
    );
    expect(secondLeftScaleCall?.[1]).toBeCloseTo(0.5 / 1.75, 5);

    // deletePageTexture(0) で右4タイルすべての WebGLTexture が破棄される
    mocks.deleteTexture.mockClear();
    renderer.deletePageTexture(0);
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(4);
  });

  it("16タイル超過時および分割失敗時に上限内安全リサイズへフォールバックし、双方失敗時のみerror記録と再試行抑止を行うこと (AC-GL-07)", async () => {
    // 1. 16タイル超過 (500x400 with maxTextureSize=100 -> 5x4=20 > 16) -> default createImageBitmap リサイズ経路
    const resizedTemp = createFakeBitmap(100, 80);
    const resizeCalls: Array<{
      resizeWidth: number;
      resizeHeight: number;
      resizeQuality: string;
    }> = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        async (
          _bitmap: ImageBitmap,
          opts: {
            resizeWidth: number;
            resizeHeight: number;
            resizeQuality: string;
          },
        ) => {
          resizeCalls.push(opts);
          return resizedTemp;
        },
      ),
    );

    const { gl: gl1 } = createMockWebGL2Context({ maxTextureSize: 100 });
    const onReady1 = vi.fn();
    const renderer1 = new WebGLRendererCore(gl1, {
      onAsyncTextureReady: onReady1,
    });
    const hugeBitmap = createFakeBitmap(500, 400);
    renderer1.renderSlots([
      {
        slot: { pageIndex: 0, position: "center" },
        frame: createReadyFrame(0, hugeBitmap),
      },
    ]);
    await flushMicrotasks();

    expect(resizeCalls).toEqual([
      { resizeWidth: 100, resizeHeight: 80, resizeQuality: "high" },
    ]);
    expect(resizedTemp.close).toHaveBeenCalledTimes(1);
    expect(onReady1).toHaveBeenCalledWith(0);

    // 2. 極端縦横比 (50000x10 with max=100) で短辺が最小1にクランプされること＋分割失敗時の途中タイル破棄
    let cropCallIndex = 0;
    const partialTile = createFakeBitmap(100, 10);
    const resizedExtreme = createFakeBitmap(100, 1);
    const { gl: gl2, mocks: m2 } = createMockWebGL2Context({
      maxTextureSize: 100,
    });
    const onReady2 = vi.fn();
    const resizerMock2 = vi.fn(async () => resizedExtreme);
    const renderer2 = new WebGLRendererCore(gl2, {
      onAsyncTextureReady: onReady2,
      bitmapCropper: async () => {
        cropCallIndex += 1;
        if (cropCallIndex === 1) {
          return partialTile;
        }
        throw new Error("crop failed");
      },
      bitmapResizer: resizerMock2,
    });
    // 200x10 (2x1=2タイル): 1枚目成功して texture 作成後、2枚目で失敗 -> 途中 texture を deleteTexture してリサイズへ
    renderer2.renderSlots([
      {
        slot: { pageIndex: 0, position: "center" },
        frame: createReadyFrame(0, createFakeBitmap(200, 10)),
      },
    ]);
    await flushMicrotasks();
    expect(partialTile.close).toHaveBeenCalledTimes(1);
    expect(m2.deleteTexture).toHaveBeenCalledTimes(1);
    expect(resizerMock2).toHaveBeenCalledWith(expect.anything(), 100, 5);
    expect(resizedExtreme.close).toHaveBeenCalledTimes(1);
    expect(onReady2).toHaveBeenCalledWith(0);

    // 極端アスペクト (10000x10 with max=100 -> tiles=100 > 16 -> resize 100x1)
    const resizerMockExtreme = vi.fn(async () => createFakeBitmap(100, 1));
    const rendererExtreme = new WebGLRendererCore(gl2, {
      bitmapResizer: resizerMockExtreme,
    });
    rendererExtreme.renderSlots([
      {
        slot: { pageIndex: 1, position: "center" },
        frame: createReadyFrame(1, createFakeBitmap(10000, 10)),
      },
    ]);
    await flushMicrotasks();
    expect(resizerMockExtreme).toHaveBeenCalledWith(expect.anything(), 100, 1);

    // 3. 分割の createTexture null 失敗 -> リサイズも文字列非Errorで失敗 -> 双方失敗時のみ error 記録＆無限リトライ抑止
    diagnosticLogger.clear();
    const tileFailTex = createFakeBitmap(100, 100);
    const { gl: gl3, mocks: m3 } = createMockWebGL2Context({
      maxTextureSize: 100,
      createTexture: () => null,
    });
    const resizerFail = vi.fn(async () => {
      throw "resize string error";
    });
    const renderer3 = new WebGLRendererCore(gl3, {
      bitmapCropper: async () => tileFailTex,
      bitmapResizer: resizerFail,
    });
    const brokenOversized = createFakeBitmap(200, 100);
    renderer3.renderSlots([
      {
        slot: { pageIndex: 3, position: "center" },
        frame: createReadyFrame(3, brokenOversized),
      },
    ]);
    await flushMicrotasks();

    expect(tileFailTex.close).toHaveBeenCalledTimes(1);
    expect(resizerFail).toHaveBeenCalledTimes(1);
    const errors = diagnosticLogger
      .getEntries()
      .filter((e) => e.level === "error" && e.scope === "webgl2");
    expect(errors).toHaveLength(1);

    // 同一 bitmap を再描画しても再試行しない（warn/error 増えない）
    resizerFail.mockClear();
    renderer3.renderSlots([
      {
        slot: { pageIndex: 3, position: "center" },
        frame: createReadyFrame(3, brokenOversized),
      },
    ]);
    await flushMicrotasks();
    expect(resizerFail).not.toHaveBeenCalled();
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(1);

    // 4. リサイズ側 createTexture null 失敗も安全に失敗ガード登録・error記録すること
    diagnosticLogger.clear();
    const resizedTempNull = createFakeBitmap(100, 50);
    const renderer4 = new WebGLRendererCore(gl3, {
      bitmapResizer: async () => resizedTempNull,
    });
    renderer4.renderSlots([
      {
        slot: { pageIndex: 4, position: "center" },
        frame: createReadyFrame(4, createFakeBitmap(2000, 1000)),
      },
    ]);
    await flushMicrotasks();
    expect(resizedTempNull.close).toHaveBeenCalledTimes(1);
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(1);
    expect(m3.drawArrays).not.toHaveBeenCalled();
  });

  it("非同期準備中のキャンセル（deletePageTexture / notifyContextLost / 上書き / dispose / isContextLost）で一時bitmapと途中テクスチャを即解放しリサイズやerrorログを出さないこと (AC-GL-05, AC-GL-07)", async () => {
    // 1. deletePageTexture による await 解決時キャンセル（途中タイル破棄＆リサイズ抑止）
    const d1Tile1 = createDeferred<ImageBitmap>();
    const d1Tile2 = createDeferred<ImageBitmap>();
    let seq1 = 0;
    const { gl: gl1, mocks: m1 } = createMockWebGL2Context({
      maxTextureSize: 100,
    });
    const resizer1 = vi.fn();
    const onReady1 = vi.fn();
    const renderer1 = new WebGLRendererCore(gl1, {
      onAsyncTextureReady: onReady1,
      bitmapCropper: () => {
        seq1 += 1;
        return seq1 === 1 ? d1Tile1.promise : d1Tile2.promise;
      },
      bitmapResizer: resizer1,
    });
    renderer1.renderSlots([
      {
        slot: { pageIndex: 0, position: "center" },
        frame: createReadyFrame(0, createFakeBitmap(200, 100)),
      },
    ]);
    const b1 = createFakeBitmap(100, 100);
    d1Tile1.resolve(b1);
    await flushMicrotasks();

    // 2枚目 await 中に deletePageTexture(0)
    renderer1.deletePageTexture(0);
    const b2 = createFakeBitmap(100, 100);
    d1Tile2.resolve(b2);
    await flushMicrotasks();

    expect(b1.close).toHaveBeenCalledTimes(1);
    expect(b2.close).toHaveBeenCalledTimes(1);
    expect(m1.deleteTexture).toHaveBeenCalledTimes(1);
    expect(resizer1).not.toHaveBeenCalled();
    expect(onReady1).not.toHaveBeenCalled();
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(0);

    // 2. notifyContextLost による非同期 reject 時のキャンセル（リサイズ・errorログなし）＋ 同一ページ別画像上書きキャンセル
    const d2 = createDeferred<ImageBitmap>();
    const { gl: gl2 } = createMockWebGL2Context({ maxTextureSize: 100 });
    const resizer2 = vi.fn();
    const renderer2 = new WebGLRendererCore(gl2, {
      bitmapCropper: () => d2.promise,
      bitmapResizer: resizer2,
    });
    renderer2.renderSlots([
      {
        slot: { pageIndex: 0, position: "center" },
        frame: createReadyFrame(0, createFakeBitmap(200, 100)),
      },
    ]);
    renderer2.notifyContextLost();
    d2.reject(new Error("cancelled after context lost"));
    await flushMicrotasks();
    expect(resizer2).not.toHaveBeenCalled();
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(0);
    // dispose 済み notifyContextLost も無害
    renderer2.dispose();
    renderer2.notifyContextLost();

    // 3. texImage2D 同期中に context lost になった場合の次タイル pre-await 再検証キャンセル
    let lostFlag = false;
    let texCount = 0;
    const { gl: gl3, mocks: m3 } = createMockWebGL2Context({
      maxTextureSize: 100,
      isContextLost: () => lostFlag,
      onTexImage2D: () => {
        texCount += 1;
        if (texCount === 1) {
          lostFlag = true;
        }
      },
    });
    const cropper3 = vi.fn(async () => createFakeBitmap(100, 100));
    const resizer3 = vi.fn();
    const renderer3 = new WebGLRendererCore(gl3, {
      bitmapCropper: cropper3,
      bitmapResizer: resizer3,
    });
    renderer3.renderSlots([
      {
        slot: { pageIndex: 1, position: "center" },
        frame: createReadyFrame(1, createFakeBitmap(200, 100)),
      },
    ]);
    await flushMicrotasks();
    expect(cropper3).toHaveBeenCalledTimes(1);
    expect(m3.deleteTexture).toHaveBeenCalledTimes(1);
    expect(resizer3).not.toHaveBeenCalled();

    // 4. リサイズ fallback 中のキャンセル（解決時および reject 時）
    const d4Resolve = createDeferred<ImageBitmap>();
    const { gl: gl4 } = createMockWebGL2Context({ maxTextureSize: 100 });
    const renderer4 = new WebGLRendererCore(gl4, {
      bitmapResizer: () => d4Resolve.promise,
    });
    renderer4.renderSlots([
      {
        slot: { pageIndex: 2, position: "center" },
        frame: createReadyFrame(2, createFakeBitmap(2000, 1000)),
      },
    ]);
    renderer4.clearAllTextures();
    const r4Bitmap = createFakeBitmap(100, 50);
    d4Resolve.resolve(r4Bitmap);
    await flushMicrotasks();
    expect(r4Bitmap.close).toHaveBeenCalledTimes(1);
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(0);

    const d4Reject = createDeferred<ImageBitmap>();
    const renderer5 = new WebGLRendererCore(gl4, {
      bitmapResizer: () => d4Reject.promise,
    });
    renderer5.renderSlots([
      {
        slot: { pageIndex: 2, position: "center" },
        frame: createReadyFrame(2, createFakeBitmap(2000, 1000)),
      },
    ]);
    // 別通常ページで上書きキャンセル
    renderer5.renderSlots([
      {
        slot: { pageIndex: 2, position: "center" },
        frame: createReadyFrame(2, createFakeBitmap(50, 50)),
      },
    ]);
    d4Reject.reject(new Error("late resize error"));
    await flushMicrotasks();
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(0);

    // 5. createTexture null 時に context lost 済みだった場合は error 記録せず終了すること
    let lostOnCreateTex = false;
    const { gl: gl6 } = createMockWebGL2Context({
      maxTextureSize: 100,
      omitIsContextLost: false,
      isContextLost: () => lostOnCreateTex,
      createTexture: () => {
        lostOnCreateTex = true;
        return null;
      },
    });
    const renderer6 = new WebGLRendererCore(gl6, {
      bitmapCropper: async () => createFakeBitmap(100, 100),
      bitmapResizer: async () => createFakeBitmap(100, 50),
    });
    renderer6.renderSlots([
      {
        slot: { pageIndex: 5, position: "center" },
        frame: createReadyFrame(5, createFakeBitmap(200, 100)),
      },
    ]);
    await flushMicrotasks();
    renderer6.renderSlots([
      {
        slot: { pageIndex: 6, position: "center" },
        frame: createReadyFrame(6, createFakeBitmap(2000, 1000)),
      },
    ]);
    await flushMicrotasks();
    expect(
      diagnosticLogger.getEntries().filter((e) => e.level === "error"),
    ).toHaveLength(0);

    // 6. gl.isContextLost 未定義環境かつ gl.isContextLost()===true 時の renderSlots スキップ
    const { gl: glNoMethod } = createMockWebGL2Context({
      omitIsContextLost: true,
    });
    const rendererNoMethod = new WebGLRendererCore(glNoMethod);
    expect(
      rendererNoMethod.renderSlots([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: createReadyFrame(0),
        },
      ]),
    ).toEqual([{ pageIndex: 0, position: "center" }]);

    const { gl: glLost } = createMockWebGL2Context({
      isContextLost: () => true,
    });
    const rendererLost = new WebGLRendererCore(glLost);
    expect(
      rendererLost.renderSlots([
        {
          slot: { pageIndex: 0, position: "center" },
          frame: createReadyFrame(0),
        },
      ]),
    ).toEqual([]);
  });

  it("deletePageTexture・clearAllTextures・reinitializeAfterContextLost・disposeが適切にリソースを管理すること (AC-GL-05)", () => {
    const { gl, mocks } = createMockWebGL2Context();
    const renderer = new WebGLRendererCore(gl);

    renderer.renderFrame(createReadyFrame(0));
    renderer.renderFrame(createReadyFrame(1));

    renderer.deletePageTexture(99);
    expect(mocks.deleteTexture).not.toHaveBeenCalled();

    renderer.deletePageTexture(0);
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(1);

    renderer.clearAllTextures();
    expect(mocks.deleteTexture).toHaveBeenCalledTimes(2);

    const bitmap2 = createFakeBitmap();
    renderer.renderFrame(createReadyFrame(2, bitmap2));
    renderer.resize(640, 480, 1);
    mocks.viewport.mockClear();
    mocks.texImage2D.mockClear();

    renderer.reinitializeAfterContextLost();
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 640, 480);

    renderer.renderFrame(createReadyFrame(2, bitmap2));
    expect(mocks.texImage2D).toHaveBeenCalledTimes(1);
    expect(mocks.generateMipmap).toHaveBeenCalled();

    renderer.dispose();
    expect(mocks.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(mocks.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProgram).toHaveBeenCalledTimes(1);

    renderer.dispose();
    expect(renderer.resize(800, 600, 1)).toBe(false);
    renderer.renderFrame(createReadyFrame(3));
    renderer.reinitializeAfterContextLost();
  });

  it("resize前のreinitializeAfterContextLostと、再初期化失敗後のrenderFrame・disposeが安全に動作すること", () => {
    let shouldFailNextProgram = false;
    const { gl, mocks } = createMockWebGL2Context({
      createProgram: () =>
        shouldFailNextProgram ? null : ({ id: 1 } as unknown as WebGLProgram),
    });
    const renderer = new WebGLRendererCore(gl);

    renderer.reinitializeAfterContextLost();
    expect(mocks.viewport).not.toHaveBeenCalled();

    shouldFailNextProgram = true;
    expect(() => renderer.reinitializeAfterContextLost()).toThrow(
      WebGLInitError,
    );

    renderer.renderFrame(createReadyFrame(0));
    renderer.dispose();
    expect(mocks.deleteProgram).not.toHaveBeenCalled();
  });
});

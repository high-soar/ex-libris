import { describe, expect, it, vi } from "vitest";
import type { DecodedPageFrame } from "../engine/types";
import {
  WebGLInitError,
  WebGLRendererCore,
  clampViewportDimensions,
  computeAspectFitScale,
} from "./WebGLRendererCore";

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

interface MockGLOverrides {
  canvasWidth?: number;
  canvasHeight?: number;
  maxViewportDims?: ArrayLike<number> | null;
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
    shaderTypes,
  };
}

describe("computeAspectFitScale", () => {
  it("画像とビューポートのアスペクト比に応じて中央内接スケールを計算すること (AC-GL-02)", () => {
    // 縦長画像 (800x1200, ratio=2/3) を正方形ビューポート (1200x1200, ratio=1) に内接
    const [sx1, sy1] = computeAspectFitScale(800, 1200, 1200, 1200);
    expect(sx1).toBeCloseTo(2 / 3);
    expect(sy1).toBe(1);

    // 横長画像 (1600x800, ratio=2) を正方形ビューポート (1000x1000, ratio=1) に内接
    const [sx2, sy2] = computeAspectFitScale(1600, 800, 1000, 1000);
    expect(sx2).toBe(1);
    expect(sy2).toBeCloseTo(0.5);

    // 同一アスペクト比は等倍 [1, 1]
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

    // 幅超過: 6000x4000 -> 4096x2730
    expect(clampViewportDimensions(3000, 2000, 2, [4096, 4096])).toEqual({
      width: 4096,
      height: 2730,
    });

    // 高さ超過: 2000x6000 -> 1365x4096
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
    // 1. 頂点 createShader null
    const { gl: gl1 } = createMockWebGL2Context({
      createShader: () => null,
    });
    expect(() => new WebGLRendererCore(gl1)).toThrow(WebGLInitError);

    // 2. 頂点コンパイル失敗 (infoLog=null含む)
    const { gl: gl2, mocks: m2 } = createMockWebGL2Context({
      compileStatus: () => false,
      shaderInfoLog: null,
    });
    expect(() => new WebGLRendererCore(gl2)).toThrow(WebGLInitError);
    expect(m2.deleteShader).toHaveBeenCalledTimes(1);

    // 3. フラグメント createShader null -> 頂点シェーダー解放
    const { gl: gl3, mocks: m3 } = createMockWebGL2Context({
      createShader: (type) =>
        type === 0x8b31 ? ({ id: 1 } as unknown as WebGLShader) : null,
    });
    expect(() => new WebGLRendererCore(gl3)).toThrow(WebGLInitError);
    expect(m3.deleteShader).toHaveBeenCalledTimes(1);

    // 4. フラグメントコンパイル失敗 -> 両シェーダー解放
    const {
      gl: gl4,
      mocks: m4,
      shaderTypes: st4,
    } = createMockWebGL2Context({
      compileStatus: (shader) => st4.get(shader) === 0x8b31,
    });
    expect(() => new WebGLRendererCore(gl4)).toThrow(WebGLInitError);
    expect(m4.deleteShader).toHaveBeenCalledTimes(2);

    // 5. createProgram null -> 両シェーダー解放
    const { gl: gl5, mocks: m5 } = createMockWebGL2Context({
      createProgram: () => null,
    });
    expect(() => new WebGLRendererCore(gl5)).toThrow(WebGLInitError);
    expect(m5.deleteShader).toHaveBeenCalledTimes(2);

    // 6. linkProgram 失敗 (infoLog=null) -> program + 両シェーダー解放
    const { gl: gl6, mocks: m6 } = createMockWebGL2Context({
      linkStatus: false,
      programInfoLog: null,
    });
    expect(() => new WebGLRendererCore(gl6)).toThrow(WebGLInitError);
    expect(m6.deleteProgram).toHaveBeenCalledTimes(1);
    expect(m6.deleteShader).toHaveBeenCalledTimes(2);

    // 7. attribute / uniform ロケーション取得失敗 -> program + 両シェーダー解放
    const badLocationCases: MockGLOverrides[] = [
      { attribLocations: { a_position: -1 } },
      { attribLocations: { a_texCoord: -1 } },
      { uniformLocations: { u_scale: null } },
      { uniformLocations: { u_texture: null } },
    ];
    for (const badOverrides of badLocationCases) {
      const { gl: glLoc, mocks: mLoc } = createMockWebGL2Context(badOverrides);
      expect(() => new WebGLRendererCore(glLoc)).toThrow(WebGLInitError);
      expect(mLoc.deleteProgram).toHaveBeenCalledTimes(1);
      expect(mLoc.deleteShader).toHaveBeenCalledTimes(2);
    }

    // 8. createVertexArray null -> vbo + program + 両シェーダー解放
    const { gl: gl8, mocks: m8 } = createMockWebGL2Context({
      createVertexArray: () => null,
    });
    expect(() => new WebGLRendererCore(gl8)).toThrow(WebGLInitError);
    expect(m8.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(m8.deleteVertexArray).not.toHaveBeenCalled();
    expect(m8.deleteProgram).toHaveBeenCalledTimes(1);

    // 9. createBuffer null -> vao + program + 両シェーダー解放
    const { gl: gl9, mocks: m9 } = createMockWebGL2Context({
      createBuffer: () => null,
    });
    expect(() => new WebGLRendererCore(gl9)).toThrow(WebGLInitError);
    expect(m9.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(m9.deleteBuffer).not.toHaveBeenCalled();
    expect(m9.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it("resizeが実変更時のみcanvasサイズとgl.viewportを更新すること (AC-GL-04)", () => {
    const { gl, mocks } = createMockWebGL2Context({
      canvasWidth: 300,
      canvasHeight: 150,
    });
    const renderer = new WebGLRendererCore(gl);

    // 初回はサイズ一致でも gl.viewport を設定する
    expect(renderer.resize(300, 150, 1)).toBe(true);
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 300, 150);

    // 同一実サイズでは何もしない
    mocks.viewport.mockClear();
    expect(renderer.resize(300, 150, 1)).toBe(false);
    expect(mocks.viewport).not.toHaveBeenCalled();

    // サイズ変更時は canvas と viewport を更新
    expect(renderer.resize(800, 600, 2)).toBe(true);
    expect(mocks.canvas.width).toBe(1600);
    expect(mocks.canvas.height).toBe(1200);
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 1600, 1200);

    // 高さのみ変更時も canvas と viewport を更新
    expect(renderer.resize(800, 500, 2)).toBe(true);
    expect(mocks.canvas.width).toBe(1600);
    expect(mocks.canvas.height).toBe(1000);
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 1600, 1000);
  });

  it("renderFrameが純黒クリア・UNPACK_ALIGNMENT=1・generateMipmap・LINEAR_MIPMAP_LINEAR・アスペクト維持描画を行うこと (AC-GL-02, AC-GL-03)", () => {
    const { gl, mocks } = createMockWebGL2Context({
      canvasWidth: 1000,
      canvasHeight: 1000,
    });
    const renderer = new WebGLRendererCore(gl);

    // null フレームと error フレームは純黒クリアのみ実行（resize未呼出時はcanvasサイズ参照）
    renderer.renderFrame(null);
    expect(mocks.clearColor).toHaveBeenCalledWith(0, 0, 0, 1);
    expect(mocks.clear).toHaveBeenCalledWith(mocks.COLOR_BUFFER_BIT);
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    renderer.renderFrame({
      status: "error",
      pageIndex: 0,
      epoch: 1,
      errorCode: "DECODE_FAILED",
      message: "broken",
    });
    expect(mocks.drawArrays).not.toHaveBeenCalled();

    // ready フレーム描画
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
      expect.anything(),
      expect.closeTo(2 / 3, 5),
      1,
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

    renderer.renderFrame(createReadyFrame(0));
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.drawArrays).not.toHaveBeenCalled();
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

    // resize 済みの状態からのコンテキストロスト復帰 -> プログラム・VAO/VBO・viewport再設定＋テクスチャ再生成
    const bitmap2 = createFakeBitmap();
    renderer.renderFrame(createReadyFrame(2, bitmap2));
    renderer.resize(640, 480, 1);
    mocks.viewport.mockClear();
    mocks.texImage2D.mockClear();

    renderer.reinitializeAfterContextLost();
    expect(mocks.viewport).toHaveBeenCalledWith(0, 0, 640, 480);

    // ロスト前のテクスチャマップは破棄されているため同一bitmapでも再アップロードする
    renderer.renderFrame(createReadyFrame(2, bitmap2));
    expect(mocks.texImage2D).toHaveBeenCalledTimes(1);
    expect(mocks.generateMipmap).toHaveBeenCalled();

    // dispose() は全リソースを解放し、再呼出や後続メソッド呼出を無害化する
    renderer.dispose();
    expect(mocks.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(mocks.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProgram).toHaveBeenCalledTimes(1);

    // 2度目の dispose および破棄後呼出は何もしない
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

    // resize 前でも reinitializeAfterContextLost が成功し viewport は呼ばれない
    renderer.reinitializeAfterContextLost();
    expect(mocks.viewport).not.toHaveBeenCalled();

    // コンテキスト復帰で再初期化失敗すると pipeline === null 状態となる
    shouldFailNextProgram = true;
    expect(() => renderer.reinitializeAfterContextLost()).toThrow(
      WebGLInitError,
    );

    // pipeline === null でも renderFrame / dispose はクラッシュしない
    renderer.renderFrame(createReadyFrame(0));
    renderer.dispose();
    expect(mocks.deleteProgram).not.toHaveBeenCalled();
  });
});

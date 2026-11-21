import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import type { DecodedPageFrame } from "../engine/types";
import { ReaderCanvas, type ReaderCanvasProps } from "./ReaderCanvas";
import type { RenderSlotFrame, SlotPosition } from "./types";

interface StorySlotSpec {
  readonly pageIndex: number;
  readonly position: SlotPosition;
  readonly width: number;
  readonly height: number;
  readonly epoch: number;
  readonly label: string;
  readonly accentColor: string;
}

function createFakeStoryBitmap(width: number, height: number): ImageBitmap {
  return {
    width,
    height,
    close: () => {},
  } as unknown as ImageBitmap;
}

async function createRealStoryBitmap(
  spec: StorySlotSpec,
): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, spec.width, spec.height);
    ctx.strokeStyle = spec.accentColor;
    ctx.lineWidth = 16;
    ctx.strokeRect(24, 24, spec.width - 48, spec.height - 48);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `bold ${Math.max(24, Math.floor(spec.width * 0.12))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.label, spec.width / 2, spec.height / 2);
  }
  return createImageBitmap(canvas);
}

function buildSlotsFromBitmaps(
  specs: readonly StorySlotSpec[],
  bitmaps: readonly ImageBitmap[],
): RenderSlotFrame[] {
  return specs.map((spec, index) => {
    const bitmap = bitmaps[index];
    const frame: DecodedPageFrame = {
      status: "ready",
      pageIndex: spec.pageIndex,
      epoch: spec.epoch,
      width: spec.width,
      height: spec.height,
      bitmap,
    };
    return {
      slot: { pageIndex: spec.pageIndex, position: spec.position },
      frame,
    };
  });
}

function useStorySlots(
  specs: readonly StorySlotSpec[],
): readonly RenderSlotFrame[] | null {
  const [slots, setSlots] = useState<readonly RenderSlotFrame[] | null>(() => {
    if (typeof createImageBitmap !== "function") {
      return buildSlotsFromBitmaps(
        specs,
        specs.map((spec) => createFakeStoryBitmap(spec.width, spec.height)),
      );
    }
    return null;
  });

  useEffect(() => {
    if (typeof createImageBitmap !== "function") {
      return;
    }
    let cancelled = false;
    const created: ImageBitmap[] = [];
    void Promise.all(specs.map((spec) => createRealStoryBitmap(spec))).then(
      (bitmaps) => {
        if (cancelled) {
          for (const bitmap of bitmaps) {
            bitmap.close();
          }
          return;
        }
        created.push(...bitmaps);
        setSlots(buildSlotsFromBitmaps(specs, bitmaps));
      },
    );
    return () => {
      cancelled = true;
      for (const bitmap of created) {
        bitmap.close();
      }
    };
  }, [specs]);

  return slots;
}

function StorySlotsCanvas({
  specs,
  canvasProps,
}: {
  readonly specs: readonly StorySlotSpec[];
  readonly canvasProps: Partial<ReaderCanvasProps>;
}) {
  const resolvedSlots = useStorySlots(specs);
  if (resolvedSlots === null) {
    return null;
  }
  return <ReaderCanvas {...canvasProps} slots={resolvedSlots} />;
}

function ContextLostStoryHost(props: Partial<ReaderCanvasProps>) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = hostRef.current?.querySelector(
      '[data-testid="reader-canvas"]',
    );
    if (canvas) {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    }
  }, []);

  return (
    <div ref={hostRef} className="h-full w-full">
      <ReaderCanvas slots={[]} {...props} />
    </div>
  );
}

function createMockStoryWebGL2Context(
  maxTextureSize = 4096,
): (canvas: HTMLCanvasElement) => WebGL2RenderingContext {
  return (canvas) => {
    const gl = {
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
      isContextLost: () => false,
      createShader: () => ({}) as WebGLShader,
      shaderSource: () => {},
      compileShader: () => {},
      getShaderParameter: () => true,
      getShaderInfoLog: () => "",
      deleteShader: () => {},
      createProgram: () => ({}) as WebGLProgram,
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => true,
      getProgramInfoLog: () => "",
      deleteProgram: () => {},
      getAttribLocation: (_p: WebGLProgram, name: string) =>
        name === "a_position" ? 0 : 1,
      getUniformLocation: () => ({}) as WebGLUniformLocation,
      createVertexArray: () => ({}) as WebGLVertexArrayObject,
      deleteVertexArray: () => {},
      bindVertexArray: () => {},
      createBuffer: () => ({}) as WebGLBuffer,
      deleteBuffer: () => {},
      bindBuffer: () => {},
      bufferData: () => {},
      enableVertexAttribArray: () => {},
      vertexAttribPointer: () => {},
      getParameter: (pname: number) =>
        pname === 0x0d33 ? maxTextureSize : new Int32Array([4096, 4096]),
      clearColor: () => {},
      clear: () => {},
      viewport: () => {},
      createTexture: () => ({}) as WebGLTexture,
      deleteTexture: () => {},
      activeTexture: () => {},
      bindTexture: () => {},
      pixelStorei: () => {},
      texImage2D: () => {},
      generateMipmap: () => {},
      texParameteri: () => {},
      useProgram: () => {},
      uniform2f: () => {},
      uniform1i: () => {},
      drawArrays: () => {},
    };
    return gl as unknown as WebGL2RenderingContext;
  };
}

const SINGLE_SLOT_SPECS: readonly StorySlotSpec[] = [
  {
    pageIndex: 0,
    position: "center",
    width: 600,
    height: 900,
    epoch: 1,
    label: "P.1",
    accentColor: "#6366f1",
  },
];

const SPREAD_SLOT_SPECS: readonly StorySlotSpec[] = [
  {
    pageIndex: 2,
    position: "left",
    width: 600,
    height: 900,
    epoch: 2,
    label: "P.3",
    accentColor: "#38bdf8",
  },
  {
    pageIndex: 1,
    position: "right",
    width: 600,
    height: 900,
    epoch: 2,
    label: "P.2",
    accentColor: "#818cf8",
  },
];

const OVERSIZED_SLOT_SPECS: readonly StorySlotSpec[] = [
  {
    pageIndex: 0,
    position: "center",
    width: 200,
    height: 100,
    epoch: 1,
    label: "BIG",
    accentColor: "#f59e0b",
  },
];

const meta: Meta<typeof ReaderCanvas> = {
  title: "WebGL/ReaderCanvas",
  component: ReaderCanvas,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="h-screen w-screen bg-black">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReaderCanvas>;

/** 待機中の純黒 WebGL2 キャンバス表示 */
export const Default: Story = {
  name: "待機状態（純黒キャンバス）",
  args: {
    slots: [],
  },
};

/** 単ページ中央スロット描画状態 */
export const SingleSlot: Story = {
  name: "単ページ描画状態",
  args: {
    slots: [],
  },
  render: (args) => (
    <StorySlotsCanvas specs={SINGLE_SLOT_SPECS} canvasProps={args} />
  ),
};

/** 見開き2スロット（左・右）背表紙密着描画状態 */
export const SpreadSlots: Story = {
  name: "見開き2スロット描画状態",
  args: {
    slots: [],
  },
  render: (args) => (
    <StorySlotsCanvas specs={SPREAD_SLOT_SPECS} canvasProps={args} />
  ),
};

/** MAX_TEXTURE_SIZE 超過時の非同期タイル分割待機状態 */
export const AsyncOversizedPending: Story = {
  name: "MAX_TEXTURE_SIZE 超過・非同期待機状態",
  args: {
    slots: [],
    getWebGL2Context: createMockStoryWebGL2Context(100),
  },
  render: (args) => (
    <StorySlotsCanvas specs={OVERSIZED_SLOT_SPECS} canvasProps={args} />
  ),
};

/** webglcontextlost 発生後の自動復帰待機状態 */
export const ContextLost: Story = {
  name: "コンテキストロスト状態",
  args: {
    slots: [],
    getWebGL2Context: createMockStoryWebGL2Context(),
  },
  render: (args) => <ContextLostStoryHost {...args} />,
};

/** WebGL2 非対応環境またはコンテキスト取得不可時のエラー状態 */
export const UnsupportedEnvironment: Story = {
  name: "WebGL2 非対応状態",
  args: {
    slots: [],
    getWebGL2Context: () => null,
  },
};

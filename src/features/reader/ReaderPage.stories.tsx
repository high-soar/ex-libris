import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect, useState } from "react";
import { ServiceProvider } from "../../app/ServiceProvider";
import type { DecodedPageFrame } from "../../engine/types";
import { RouterProvider } from "../../shared/router/RouterProvider";
import {
  ReaderPage,
  type ReaderPageInitialSnapshot,
  type ReaderPageProps,
} from "./ReaderPage";
import { useLocalReaderSessionStore } from "./localReaderSessionStore";

const STORY_ARCHIVE_FILE = new File(
  ["storybook-mock-comic"],
  "sample-comic-vol01.cbz",
  { type: "application/x-cbz" },
);

interface StoryPageSpec {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
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
  spec: StoryPageSpec,
): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, spec.width, spec.height);
    ctx.strokeStyle = spec.accentColor;
    ctx.lineWidth = 14;
    ctx.strokeRect(20, 20, spec.width - 40, spec.height - 40);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `bold ${Math.max(24, Math.floor(Math.min(spec.width, spec.height) * 0.14))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.label, spec.width / 2, spec.height / 2);
  }
  return createImageBitmap(canvas);
}

function buildFramesRecord(
  specs: readonly StoryPageSpec[],
  bitmaps: readonly ImageBitmap[],
  extraFrames: Readonly<Record<number, DecodedPageFrame>> = {},
): Readonly<Record<number, DecodedPageFrame>> {
  const record: Record<number, DecodedPageFrame> = { ...extraFrames };
  specs.forEach((spec, index) => {
    const bitmap = bitmaps[index];
    record[spec.pageIndex] = {
      status: "ready",
      pageIndex: spec.pageIndex,
      epoch: 1,
      width: spec.width,
      height: spec.height,
      bitmap,
    };
  });
  return record;
}

function useStoryPageFrames(
  specs: readonly StoryPageSpec[],
  extraFrames?: Readonly<Record<number, DecodedPageFrame>>,
): Readonly<Record<number, DecodedPageFrame>> | null {
  const [frames, setFrames] = useState<Readonly<
    Record<number, DecodedPageFrame>
  > | null>(() => {
    if (typeof createImageBitmap !== "function") {
      return buildFramesRecord(
        specs,
        specs.map((spec) => createFakeStoryBitmap(spec.width, spec.height)),
        extraFrames,
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
        setFrames(buildFramesRecord(specs, bitmaps, extraFrames));
      },
    );
    return () => {
      cancelled = true;
      for (const bitmap of created) {
        bitmap.close();
      }
    };
  }, [extraFrames, specs]);

  return frames;
}

function StoryPageWithBitmaps({
  specs,
  extraFrames,
  snapshot,
  pageProps,
}: {
  readonly specs: readonly StoryPageSpec[];
  readonly extraFrames?: Readonly<Record<number, DecodedPageFrame>>;
  readonly snapshot: ReaderPageInitialSnapshot;
  readonly pageProps: ReaderPageProps;
}) {
  const framesByPage = useStoryPageFrames(specs, extraFrames);
  if (framesByPage === null) {
    return null;
  }
  return (
    <ReaderPage
      {...pageProps}
      initialSnapshot={{
        ...snapshot,
        ...pageProps.initialSnapshot,
        framesByPage: pageProps.initialSnapshot?.framesByPage ?? framesByPage,
      }}
    />
  );
}

function StorySessionDecorator({ children }: { readonly children: ReactNode }) {
  useState(() => {
    useLocalReaderSessionStore.getState().openLocalFile(STORY_ARCHIVE_FILE);
    return true;
  });

  return (
    <ServiceProvider>
      <RouterProvider initialPath="/read/local">{children}</RouterProvider>
    </ServiceProvider>
  );
}

const SPREAD_RTL_SPECS: readonly StoryPageSpec[] = [
  {
    pageIndex: 1,
    width: 600,
    height: 900,
    label: "P.2",
    accentColor: "#6366f1",
  },
  {
    pageIndex: 2,
    width: 600,
    height: 900,
    label: "P.3",
    accentColor: "#38bdf8",
  },
];

const SPREAD_LTR_OFFSET_SPECS: readonly StoryPageSpec[] = [
  {
    pageIndex: 2,
    width: 600,
    height: 900,
    label: "P.3",
    accentColor: "#38bdf8",
  },
  {
    pageIndex: 3,
    width: 600,
    height: 900,
    label: "P.4",
    accentColor: "#10b981",
  },
];

const LANDSCAPE_SINGLE_SPECS: readonly StoryPageSpec[] = [
  {
    pageIndex: 4,
    width: 1200,
    height: 750,
    label: "見開き結合 P.5",
    accentColor: "#f59e0b",
  },
];

const PORTRAIT_SINGLE_SPECS: readonly StoryPageSpec[] = [
  {
    pageIndex: 1,
    width: 600,
    height: 900,
    label: "P.2",
    accentColor: "#818cf8",
  },
];

const PARTIAL_ERROR_READY_SPECS: readonly StoryPageSpec[] = [
  {
    pageIndex: 1,
    width: 600,
    height: 900,
    label: "P.2 正常",
    accentColor: "#6366f1",
  },
];

const PARTIAL_ERROR_EXTRA: Readonly<Record<number, DecodedPageFrame>> = {
  2: {
    status: "error",
    pageIndex: 2,
    epoch: 1,
    errorCode: "DECODE_FAILED",
    message: "ページの画像デコードに失敗しました",
  },
};

const meta: Meta<typeof ReaderPage> = {
  title: "Reader/ReaderPage",
  component: ReaderPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <StorySessionDecorator>
        <Story />
      </StorySessionDecorator>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReaderPage>;

/** 初期没入状態（HUD非表示・WebGL2キャンバス描画待機中） */
export const FullscreenCanvas: Story = {
  name: "フルスクリーン待機状態（HUD非表示）",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 0,
      framesByPage: {},
      isOpening: false,
      isHudOpen: false,
    },
  },
};

/** 中央タップ等で上下オーバーレイHUDを開いた状態 */
export const HudOpen: Story = {
  name: "HUD表示状態（中間ページ）",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 11,
      framesByPage: {},
      isOpening: false,
      isHudOpen: true,
    },
  },
};

/** アーカイブ破損等の致命的エラー表示状態 */
export const ArchiveError: Story = {
  name: "アーカイブエラー状態",
  args: {
    initialSnapshot: {
      totalPages: 0,
      archiveError: {
        code: "CORRUPT_ZIP",
        message: "ZIP ファイルが破損しているため開けませんでした",
      },
      isOpening: false,
      isHudOpen: false,
    },
  },
};

/** 個別ページのみデコード失敗した状態（前後めくり継続可能） */
export const PageError: Story = {
  name: "個別ページエラー状態",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 2,
      spreadMode: "single",
      framesByPage: {
        2: {
          status: "error",
          pageIndex: 2,
          epoch: 1,
          errorCode: "DECODE_FAILED",
          message: "ページの画像デコードに失敗しました",
        },
      },
      isOpening: false,
      isHudOpen: false,
    },
  },
};

/** 右開き・見開き2ページ表示＋2段HUD表示状態 */
export const SpreadRtlHudOpen: Story = {
  name: "見開き表示状態（右開き・HUD表示）",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 1,
      readingDirection: "rtl",
      spreadMode: "spread",
      spreadPageOffset: 0,
      isOpening: false,
      isHudOpen: true,
    },
  },
  render: (args) => (
    <StoryPageWithBitmaps
      specs={SPREAD_RTL_SPECS}
      snapshot={args.initialSnapshot!}
      pageProps={args}
    />
  ),
};

/** 左開き・見開き2ページ・1ページずらしON表示状態 */
export const SpreadLtrOffsetOnHudOpen: Story = {
  name: "見開き表示状態（左開き・1ページずらし・HUD表示）",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 2,
      readingDirection: "ltr",
      spreadMode: "spread",
      spreadPageOffset: 1,
      isOpening: false,
      isHudOpen: true,
    },
  },
  render: (args) => (
    <StoryPageWithBitmaps
      specs={SPREAD_LTR_OFFSET_SPECS}
      snapshot={args.initialSnapshot!}
      pageProps={args}
    />
  ),
};

/** 見開きモード中に横長画像（width > height）が自動単独中央表示された状態 */
export const LandscapeAutoSingle: Story = {
  name: "横長画像自動単独表示状態",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 4,
      readingDirection: "rtl",
      spreadMode: "spread",
      spreadPageOffset: 0,
      isOpening: false,
      isHudOpen: true,
    },
  },
  render: (args) => (
    <StoryPageWithBitmaps
      specs={LANDSCAPE_SINGLE_SPECS}
      snapshot={args.initialSnapshot!}
      pageProps={args}
    />
  ),
};

/** 縦向きビューポート（375x667基準）でautoモードが単ページ表示へ追従した状態 */
export const PortraitAutoSingle: Story = {
  name: "縦向き自動単ページ状態（375x667基準）",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 1,
      readingDirection: "rtl",
      spreadMode: "auto",
      spreadPageOffset: 0,
      viewportSize: { width: 375, height: 667 },
      isOpening: false,
      isHudOpen: true,
    },
  },
  render: (args) => (
    <StoryPageWithBitmaps
      specs={PORTRAIT_SINGLE_SPECS}
      snapshot={args.initialSnapshot!}
      pageProps={args}
    />
  ),
};

/** 見開き片側のみデコード失敗し健全側WebGL描画＋失敗側半面エラー表示となった状態 */
export const PartialSpreadError: Story = {
  name: "見開き片側ページエラー状態",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 1,
      readingDirection: "rtl",
      spreadMode: "spread",
      spreadPageOffset: 0,
      isOpening: false,
      isHudOpen: false,
    },
  },
  render: (args) => (
    <StoryPageWithBitmaps
      specs={PARTIAL_ERROR_READY_SPECS}
      extraFrames={PARTIAL_ERROR_EXTRA}
      snapshot={args.initialSnapshot!}
      pageProps={args}
    />
  ),
};

/** 画質補正ボトムシート表示状態（HUD非表示・シェーダー補正適用） */
export const ShaderSheetOpen: Story = {
  name: "画質補正シート表示状態",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 1,
      readingDirection: "rtl",
      spreadMode: "spread",
      spreadPageOffset: 0,
      shaderParams: {
        sharpness: 0.45,
        whitePoint: 0.92,
        blackPoint: 0.08,
        gamma: 0.85,
      },
      isShaderSheetOpen: true,
      shaderSaveStatus: "saved",
      isOpening: false,
      isHudOpen: false,
    },
  },
  render: (args) => (
    <StoryPageWithBitmaps
      specs={SPREAD_RTL_SPECS}
      snapshot={args.initialSnapshot!}
      pageProps={args}
    />
  ),
};

const DRIVE_VOLUME_SPECS: readonly StoryPageSpec[] = [
  {
    pageIndex: 47,
    width: 600,
    height: 900,
    label: "P.48",
    accentColor: "#6366f1",
  },
  {
    pageIndex: 48,
    width: 600,
    height: 900,
    label: "P.49",
    accentColor: "#38bdf8",
  },
];

/** Google Drive 巻の HUD 表示状態（作品名＋巻ラベル表示） */
export const DriveVolumeHudOpen: Story = {
  name: "Google Drive巻・HUD表示状態",
  args: {
    initialSnapshot: {
      totalPages: 192,
      currentPageIndex: 47,
      readingDirection: "rtl",
      spreadMode: "spread",
      spreadPageOffset: 0,
      displayTitle: "ダンジョン飯 第02巻",
      isOpening: false,
      isHudOpen: true,
    },
  },
  render: (args) => (
    <StoryPageWithBitmaps
      specs={DRIVE_VOLUME_SPECS}
      snapshot={args.initialSnapshot!}
      pageProps={args}
    />
  ),
};

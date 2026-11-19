import type { Meta, StoryObj } from "@storybook/react";
import { RouterProvider } from "./RouterProvider";
import { useRouter } from "./routerContext";

function RoutePreviewCard() {
  const { currentPath, route } = useRouter();

  return (
    <div
      data-testid="router-story-preview"
      className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
          Router State
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">route.name</dt>
            <dd data-testid="story-route-name" className="font-mono text-white">
              {route.name}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">route.path</dt>
            <dd data-testid="story-route-path" className="font-mono text-white">
              {route.path}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">currentPath</dt>
            <dd
              data-testid="story-current-path"
              className="font-mono text-emerald-300"
            >
              {currentPath}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const meta: Meta<typeof RouterProvider> = {
  title: "Router/RouterProvider",
  component: RouterProvider,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof RouterProvider>;

/** 仮想本棚ホームルート（/）の初期状態 */
export const Default: Story = {
  name: "ホームルート（/）",
  args: {
    initialPath: "/",
    children: <RoutePreviewCard />,
  },
};

/** ローカル一時 ZIP リーダールート（/read/local）の表示状態 */
export const LocalReaderRoute: Story = {
  name: "ローカルリーダールート（/read/local）",
  args: {
    initialPath: "/read/local",
    children: <RoutePreviewCard />,
  },
};

/** 未知パス指定時に安全に '/' へフォールバックした状態 */
export const UnknownFallbackRoute: Story = {
  name: "未知パスフォールバック（/）",
  args: {
    initialPath: "/unknown/path",
    children: <RoutePreviewCard />,
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { CoordinatorWorkerApi } from "../engine/types";
import { ServiceProvider } from "./ServiceProvider";
import { useServices } from "./serviceContext";

function ServiceStatusPreview() {
  const { appBridge, createCoordinatorSession } = useServices();
  const bridgeKind =
    appBridge instanceof MockAppBridge ? "MockAppBridge" : "CustomAppBridge";

  return (
    <div
      data-testid="service-provider-preview"
      className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
          ExLibris ServiceProvider
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">AppBridge</dt>
            <dd
              data-testid="story-bridge-kind"
              className="font-mono text-white"
            >
              {bridgeKind}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">CoordinatorSession</dt>
            <dd
              data-testid="story-session-factory"
              className="font-mono text-emerald-300"
            >
              {typeof createCoordinatorSession}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const injectedCustomBridge = {
  addBackButtonListener: () => () => {},
  minimizeApp: async () => {},
};
const injectedCreateCoordinatorSession = () => ({
  api: {} as CoordinatorWorkerApi,
  dispose: () => {},
});

const meta: Meta<typeof ServiceProvider> = {
  title: "App/ServiceProvider",
  component: ServiceProvider,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof ServiceProvider>;

/** Web実行環境におけるデフォルトの自動ブリッジ解決状態 */
export const Default: Story = {
  name: "デフォルト（Web環境MockAppBridge）",
  args: {
    children: <ServiceStatusPreview />,
  },
};

/** テストおよびDI用に外部からAppBridge・Sessionファクトリを注入した状態 */
export const InjectedServices: Story = {
  name: "カスタムDIブリッジ注入状態",
  args: {
    appBridge: injectedCustomBridge,
    createCoordinatorSession: injectedCreateCoordinatorSession,
    children: <ServiceStatusPreview />,
  },
};

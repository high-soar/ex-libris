import { composeStories } from "@storybook/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverExtractionSection } from "./CoverExtractionSection";
import * as stories from "./CoverExtractionSection.stories";

const {
  NoTargets,
  Running,
  Backoff,
  Paused,
  Completed,
  RetryRequired,
  IdlePending,
} = composeStories(stories);

describe("CoverExtractionSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("全 7 状態ストーリーを描画し優先順位通りの状態バッジ・進捗率・内訳件数を表示する (AC-ST-09)", () => {
    const cases = [
      {
        Story: NoTargets,
        badge: "対象なし",
        percent: "0",
        counts: ["抽出済み 0 / 0 冊", "待機 0 冊", "エラー 0 冊"],
        retryDisabled: true,
      },
      {
        Story: Running,
        badge: "抽出中",
        percent: "60",
        counts: ["抽出済み 12 / 20 冊", "待機 8 冊", "エラー 0 冊"],
        retryDisabled: true,
      },
      {
        Story: Backoff,
        badge: "バックオフ待機",
        percent: "50",
        counts: ["抽出済み 10 / 20 冊", "待機 9 冊", "エラー 1 冊"],
        retryDisabled: false,
      },
      {
        Story: Paused,
        badge: "一時停止中",
        percent: "30",
        counts: ["抽出済み 6 / 20 冊", "待機 12 冊", "エラー 2 冊"],
        retryDisabled: true,
      },
      {
        Story: Completed,
        badge: "完了",
        percent: "100",
        counts: ["抽出済み 20 / 20 冊", "待機 0 冊", "エラー 0 冊"],
        retryDisabled: true,
      },
      {
        Story: RetryRequired,
        badge: "要再試行",
        percent: "85",
        counts: ["抽出済み 17 / 20 冊", "待機 0 冊", "エラー 3 冊"],
        retryDisabled: false,
      },
      {
        Story: IdlePending,
        badge: "待機中",
        percent: "40",
        counts: ["抽出済み 4 / 10 冊", "待機 6 冊", "エラー 0 冊"],
        retryDisabled: true,
      },
    ] as const;

    for (const testCase of cases) {
      const { unmount } = render(<testCase.Story />);
      expect(
        screen.getByTestId("settings-cover-status-badge"),
      ).toHaveTextContent(testCase.badge);
      const progressBar = screen.getByTestId("settings-cover-progress-bar");
      expect(progressBar).toHaveAttribute("aria-valuenow", testCase.percent);
      const counts = screen.getByTestId("settings-cover-counts");
      for (const expectedText of testCase.counts) {
        expect(counts).toHaveTextContent(expectedText);
      }
      const retryButton = screen.getByTestId(
        "settings-retry-failed-covers-button",
      );
      if (testCase.retryDisabled) {
        expect(retryButton).toBeDisabled();
      } else {
        expect(retryButton).toBeEnabled();
      }
      unmount();
    }
  });

  it("活性条件を満たすとき「エラー分を再試行」ボタン押下で onRetryFailedCovers を呼ぶ (AC-ST-09)", () => {
    const onRetryFailedCovers = vi.fn();
    render(
      <CoverExtractionSection
        authStatus="connected"
        enabledRootCount={1}
        syncPhase="idle"
        isBackBlocked={false}
        extractionState={{
          phase: "idle",
          totalCount: 5,
          readyCount: 3,
          pendingCount: 0,
          errorCount: 2,
          activeVolumeId: null,
          pauseReasons: [],
        }}
        onRetryFailedCovers={onRetryFailedCovers}
      />,
    );

    const retryButton = screen.getByTestId(
      "settings-retry-failed-covers-button",
    );
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);
    expect(onRetryFailedCovers).toHaveBeenCalledTimes(1);
  });

  it("未連携・有効ルート0件・同期中・戻るブロック中・エラー0件のいずれかでは再試行ボタンを非活性にする (AC-ST-09)", () => {
    const disabledCases = [
      {
        authStatus: "unlinked" as const,
        enabledRootCount: 1,
        syncPhase: "idle" as const,
        isBackBlocked: false,
        errorCount: 2,
      },
      {
        authStatus: "connected" as const,
        enabledRootCount: 0,
        syncPhase: "idle" as const,
        isBackBlocked: false,
        errorCount: 2,
      },
      {
        authStatus: "connected" as const,
        enabledRootCount: 1,
        syncPhase: "syncing" as const,
        isBackBlocked: false,
        errorCount: 2,
      },
      {
        authStatus: "connected" as const,
        enabledRootCount: 1,
        syncPhase: "idle" as const,
        isBackBlocked: true,
        errorCount: 2,
      },
      {
        authStatus: "connected" as const,
        enabledRootCount: 1,
        syncPhase: "idle" as const,
        isBackBlocked: false,
        errorCount: 0,
      },
    ];

    for (const c of disabledCases) {
      const { unmount } = render(
        <CoverExtractionSection
          authStatus={c.authStatus}
          enabledRootCount={c.enabledRootCount}
          syncPhase={c.syncPhase}
          isBackBlocked={c.isBackBlocked}
          extractionState={{
            phase: "idle",
            totalCount: 5,
            readyCount: 5 - c.errorCount,
            pendingCount: 0,
            errorCount: c.errorCount,
            activeVolumeId: null,
            pauseReasons: [],
          }}
          onRetryFailedCovers={vi.fn()}
        />,
      );
      expect(
        screen.getByTestId("settings-retry-failed-covers-button"),
      ).toBeDisabled();
      unmount();
    }
  });
});

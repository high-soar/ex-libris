export interface ParseMangaFilenameInput {
  /** Google Drive 上の生ファイル名（例: "[作者名] 作品名 第01巻 (一般コミック).cbz"） */
  readonly fileName: string;
  /** 直近の親フォルダ名（サブフォルダ配下時のみ補完候補として渡す） */
  readonly parentFolderName?: string | null;
  /**
   * 親フォルダが driveSyncRoots 登録ルートフォルダ自体であるか。
   * true の場合はルートフォルダ名（例: "Comics"）への誤集約を防ぐため親フォルダ名補完を行わない。
   */
  readonly isParentSyncRoot?: boolean;
}

export interface ParsedMangaFilename {
  /** 表示用シリーズタイトル（ノイズ・著者タグ・巻数除去後、非空保証） */
  readonly title: string;
  /** シリーズ自動グルーピング用の正規化名寄せキー（非空保証） */
  readonly normalizedTitleKey: string;
  /** v0.2 五十音ソート・検索用の読み仮名初期値（ひらがな統一、非空保証） */
  readonly titleReading: string;
  /** 抽出された著者名配列（トリム・重複排除済み、未検出時は空配列） */
  readonly authors: readonly string[];
  /** ソート・欠巻判定用の巻数数値（単巻/小数/合本開始巻/上下前後編、未検出時は null） */
  readonly volumeNumber: number | null;
  /** 表示用巻ラベル（例: "第01巻", "第03巻 限定版", "第01-05巻 合本", "上巻", "単巻"） */
  readonly volumeLabel: string;
  /** 合本（複数巻まとめ）判定フラグ */
  readonly isOmnibus: boolean;
  /** 合本範囲の終了巻数（例: 01-05巻 -> 5、単巻・数値なし合本は null） */
  readonly volumeRangeEnd: number | null;
  /** 限定版・特装版・新装版等の付記（未検出時は null） */
  readonly editionNote: string | null;
}

export type RgbaTuple = readonly [number, number, number, number];

export interface ManualArchiveSpec {
  readonly filename: string;
  build(): Buffer;
}

export function computeCrc32(bytes: Uint8Array): number;

export function createSplitSamplePng(
  leftRgba: RgbaTuple,
  rightRgba: RgbaTuple,
  width: number,
  height: number,
): Buffer;

export interface Cp932Zip64EntryInput {
  readonly name: string | Uint8Array;
  readonly data: Uint8Array;
  readonly flags?: number;
  readonly compressionMethod?: 0 | 8;
}

export function buildDeterministicStoreZip(
  entries: readonly { name: string; data: Uint8Array }[],
): Buffer;

export function buildDeterministicCp932Zip64(
  entries: readonly Cp932Zip64EntryInput[],
): Buffer;

export function createShaderLabPng(width?: number, height?: number): Buffer;

export function buildHo05Cp932Zip64TestArchive(): Buffer;

export function buildHo07MaxTextureTestArchive(): Buffer;

export function buildHo08ShaderSeekTestArchive(): Buffer;

export const MANUAL_TEST_ARCHIVES: readonly ManualArchiveSpec[];

export function writeManualTestArchives(outputDir?: string): string[];

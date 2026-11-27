import type { RandomAccessReader } from "../types";

export class MockCoverArchiveRangeReader implements RandomAccessReader {
  readonly sourceId: string;
  readonly totalSize: number;

  constructor(volumeId: string) {
    this.sourceId = `mock-cover:${volumeId}`;
    this.totalSize = 0;
  }

  async readRange(
    _offset: number,
    _length: number,
    _signal?: AbortSignal,
  ): Promise<Uint8Array> {
    void _offset;
    void _length;
    void _signal;
    throw new Error("Not implemented");
  }
}

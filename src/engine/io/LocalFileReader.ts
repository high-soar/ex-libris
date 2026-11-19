import type { RandomAccessReader } from "../types";

export class LocalFileReader implements RandomAccessReader {
  readonly sourceId: string;
  readonly totalSize: number;

  constructor(private readonly file: File) {
    void this.file;
    this.sourceId = "";
    this.totalSize = -1;
  }

  async readRange(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    void offset;
    void length;
    void signal;
    throw new Error("Not implemented");
  }
}

import { create } from "zustand";

export interface LocalReaderSession {
  readonly file: File;
  readonly fileName: string;
  readonly fileSize: number;
}

export interface LocalReaderSessionState {
  session: LocalReaderSession | null;
  openLocalFile: (file: File) => void;
  clearSession: () => void;
}

export const useLocalReaderSessionStore = create<LocalReaderSessionState>(
  () => ({
    session: null,
    openLocalFile: (_file: File) => {},
    clearSession: () => {},
  }),
);

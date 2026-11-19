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
  (set) => ({
    session: null,
    openLocalFile: (file: File) => {
      set({
        session: {
          file,
          fileName: file.name,
          fileSize: file.size,
        },
      });
    },
    clearSession: () => {
      set({ session: null });
    },
  }),
);

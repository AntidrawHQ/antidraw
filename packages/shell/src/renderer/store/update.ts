import { create } from "zustand";

type UpdateStore = {
  // Version the user chose "Later" on. Deliberately in-memory: dismissal
  // lasts until the app restarts, and keying it by version means a newer
  // build re-prompts on its own.
  dismissedVersion: string | null;
  dismissVersion: (version: string) => void;
  clearDismissal: () => void;
};

export const useUpdateStore = create<UpdateStore>((set) => ({
  dismissedVersion: null,
  dismissVersion: (version) => set({ dismissedVersion: version }),
  clearDismissal: () => set({ dismissedVersion: null }),
}));

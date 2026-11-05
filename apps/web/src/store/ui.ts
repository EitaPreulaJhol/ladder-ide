import { create } from 'zustand';

export type DockTab = 'props' | 'panel' | 'plant';

interface UiState {
  dock: DockTab;
  setDock(d: DockTab | ((d: DockTab) => DockTab)): void;
  /** Tag whose value is being explained ("por que?"), highlighted in the rungs. */
  explain: string | null;
  setExplain(tag: string | null): void;
}

export const useUi = create<UiState>((set) => ({
  dock: 'panel',
  setDock: (d) => set((s) => ({ dock: typeof d === 'function' ? d(s.dock) : d })),
  explain: null,
  setExplain: (explain) => set({ explain }),
}));

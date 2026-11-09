import { create } from 'zustand';

export type DockTab = 'props' | 'panel' | 'plant';

interface UiState {
  dock: DockTab;
  setDock(d: DockTab | ((d: DockTab) => DockTab)): void;
  /** Tag whose value is being explained ("por que?"), highlighted in the rungs. */
  explain: string | null;
  setExplain(tag: string | null): void;
  /** Plant view in edit mode (a blank plant starts in it). */
  plantEditing: boolean;
  setPlantEditing(v: boolean): void;
  /** Welcome page: shown on start (except on shared links) and from the logo. */
  welcome: boolean;
  setWelcome(v: boolean): void;
  /** Keyboard shortcuts dialog ("?"). */
  shortcutsOpen: boolean;
  setShortcutsOpen(v: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  dock: 'panel',
  setDock: (d) => set((s) => ({ dock: typeof d === 'function' ? d(s.dock) : d })),
  explain: null,
  setExplain: (explain) => set({ explain }),
  plantEditing: false,
  setPlantEditing: (plantEditing) => set({ plantEditing }),
  welcome: true,
  setWelcome: (welcome) => set({ welcome }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}));

/** App-level session helpers: opening projects, autosave, shared links. */
import { EXAMPLES, forkProject, type Project } from '@ladder/core';
import { useProject } from './store/project.ts';
import { useSim } from './store/sim.ts';
import { lastProjectId, loadProject, saveProject } from './storage/db.ts';
import { fetchShare } from './api.ts';

export function openProject(p: Project, opts?: { sharedId?: string }) {
  useSim.getState().stop();
  useProject.getState().load(p, { sharedId: opts?.sharedId ?? null });
  useProject.getState().setView('editor');
}

export async function bootLocal(): Promise<void> {
  const id = lastProjectId();
  const p = id ? await loadProject(id).catch(() => null) : null;
  if (p) return openProject(p);
  const first = EXAMPLES.find((e) => e.id === 'sealIn')!.build();
  await saveProject(first).catch(() => undefined);
  openProject(first);
}

export async function bootShared(id: string): Promise<void> {
  const p = await fetchShare(id);
  openProject(p, { sharedId: id });
}

export async function forkShared(): Promise<void> {
  const { project, sharedId } = useProject.getState();
  if (!sharedId) return;
  const copy = forkProject(project, sharedId);
  await saveProject(copy);
  history.pushState(null, '', '/');
  openProject(copy);
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Debounced autosave of local (non-shared) projects. */
export function startAutosave(onSaved: () => void) {
  return useProject.subscribe((s, prev) => {
    if (!s.project || s.sharedId || s.project === prev.project) return;
    clearTimeout(saveTimer);
    const p = s.project;
    saveTimer = setTimeout(
      () =>
        void saveProject(p)
          .then(onSaved)
          .catch(() => undefined),
      600,
    );
  });
}

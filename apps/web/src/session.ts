/** App-level session helpers: opening projects, autosave, shared links. */
import i18n from 'i18next';
import { EXAMPLES, forkProject, type Project } from '@ladder/core';
import { useProject } from './store/project.ts';
import { useSim } from './store/sim.ts';
import { toast } from './store/toast.ts';
import { lastProjectId, listProjects, loadProject, saveProject } from './storage/db.ts';
import { fetchShare } from './api.ts';

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** `name`, or `name 2`, `name 3`… if another local project (not `id`) already uses it. */
export async function uniqueProjectName(name: string, id: string): Promise<string> {
  const taken = (await listProjects().catch(() => [])).filter((p) => p.id !== id).map((p) => p.name);
  let unique = name;
  for (let i = 2; taken.some((n) => sameName(n, unique)); i++) unique = `${name} ${i}`;
  return unique;
}

/** Renames the open project; warns (without refusing) when another local project has that name. */
export async function renameProject(raw: string): Promise<void> {
  const { project, update } = useProject.getState();
  const name = raw.trim() || 'Sem nome';
  if (name === project.meta.name) return;
  update((d) => void (d.meta.name = name));
  const others = await listProjects().catch(() => []);
  if (others.some((p) => p.id !== project.id && sameName(p.name, name)))
    toast(i18n.t('projects.nameTaken', { name }), { kind: 'warn', detail: i18n.t('projects.nameTakenHint') });
}

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
  copy.meta.name = await uniqueProjectName(copy.meta.name, copy.id);
  await saveProject(copy);
  history.pushState(null, '', '/');
  openProject(copy);
  toast(i18n.t('shared.forked', { name: copy.meta.name }), { kind: 'success' });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveFailing = false;
/** Debounced autosave of local (non-shared) projects. A failure is reported once, until a save works again. */
export function startAutosave(onSaved: () => void) {
  return useProject.subscribe((s, prev) => {
    if (!s.project || s.sharedId || s.project === prev.project) return;
    clearTimeout(saveTimer);
    const p = s.project;
    saveTimer = setTimeout(
      () =>
        void saveProject(p)
          .then(() => {
            saveFailing = false;
            onSaved();
          })
          .catch((e: unknown) => {
            if (saveFailing) return;
            saveFailing = true;
            toast(i18n.t('top.saveError'), {
              kind: 'error',
              detail: e instanceof Error ? e.message : String(e),
              duration: 15000,
            });
          }),
      600,
    );
  });
}

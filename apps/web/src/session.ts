/** App-level session helpers: opening projects, autosave, shared links. */
import i18n from 'i18next';
import {
  createProject,
  EXAMPLES,
  forkProject,
  importPlcopen,
  parseProject,
  type DialectId,
  type Project,
} from '@ladder/core';
import { useProject } from './store/project.ts';
import { useSim } from './store/sim.ts';
import { useUi } from './store/ui.ts';
import { toast } from './store/toast.ts';
import { listProjects, saveProject } from './storage/db.ts';
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
  useUi.getState().setWelcome(false);
}

/** Saves and opens a project that is new to this browser, with a name no other local project uses. */
export async function openNewProject(p: Project): Promise<string> {
  p.meta.name = await uniqueProjectName(p.meta.name, p.id);
  await saveProject(p);
  // Leaving a shared link: the address goes back to the local workspace.
  if (useProject.getState().sharedId) history.pushState(null, '', '/');
  openProject(p);
  return p.meta.name;
}

/** Back to the welcome page (the simulation stops; the open project stays saved). */
export function showWelcome() {
  useSim.getState().stop();
  useUi.getState().setWelcome(true);
}

export const blankProject = (dialect?: DialectId) => createProject(i18n.t('projects.new'), dialect);

/** A fresh copy of a built-in example, named in the interface language. */
export function exampleProject(id: string, dialect?: DialectId): Project {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  const p = ex.build();
  if (dialect) p.dialect = dialect;
  if (id.startsWith('scenario:')) p.meta.name = i18n.t(`plant.${id.slice(9)}.title`);
  return p;
}

/**
 * Reads a project file: one exported by this IDE (.json, opened as a copy with a new id)
 * or PLCopen XML (TC6) from another IEC 61131-3 tool, with what could not be converted.
 */
export async function readProjectFile(file: File): Promise<{ project: Project; warnings: string[] }> {
  const text = await file.text();
  if (text.trimStart().startsWith('<')) {
    const { project, warnings } = importPlcopen(text);
    // Same invariants as a JSON import (tag names, limits) before it reaches the editor.
    const r = parseProject(project);
    if (!r.ok) throw new Error(r.error);
    return { project: r.project, warnings };
  }
  const r = parseProject(JSON.parse(text));
  if (!r.ok) throw new Error(r.error);
  return { project: forkProject(r.project), warnings: [] };
}

/**
 * Opens a project file as a new local project and reports it in a toast (PLCopen
 * conversion warnings included). Returns the warnings, or null when the file was refused.
 */
export async function importProjectFile(file: File): Promise<string[] | null> {
  try {
    const { project, warnings } = await readProjectFile(file);
    const name = await openNewProject(project);
    const shown = warnings.slice(0, 3).join(' · ');
    toast(i18n.t('projects.imported', { name }), {
      kind: warnings.length ? 'warn' : 'success',
      detail: warnings.length
        ? `${i18n.t('projects.importWarnings', { n: warnings.length })} ${shown}${warnings.length > 3 ? ' …' : ''}`
        : undefined,
    });
    return warnings;
  } catch (e) {
    toast(i18n.t('projects.importError', { error: (e as Error).message }), { kind: 'error' });
    return null;
  }
}

export async function bootShared(id: string): Promise<void> {
  const p = await fetchShare(id);
  openProject(p, { sharedId: id });
}

export async function forkShared(): Promise<void> {
  const { project, sharedId } = useProject.getState();
  if (!sharedId) return;
  const copy = forkProject(project, sharedId);
  await openNewProject(copy);
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

/** Local persistence of working projects (IndexedDB). Nothing leaves the browser unless shared. */
import { openDB, type IDBPDatabase } from 'idb';
import { parseProject, type Project } from '@ladder/core';

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: string;
  project: Project;
  /** Set while the project is in the trash. */
  deletedAt?: string;
}

/** Days a project stays in the trash before it is deleted for good. */
export const TRASH_DAYS = 30;

let dbp: Promise<IDBPDatabase> | null = null;
const db = () =>
  (dbp ??= openDB('ladder-ide', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' });
    },
  }));

const LAST_KEY = 'ladder-ide:last-project';

export async function saveProject(project: Project): Promise<void> {
  const rec: StoredProject = {
    id: project.id,
    name: project.meta.name,
    updatedAt: project.meta.updatedAt,
    project,
  };
  await (await db()).put('projects', rec);
  try {
    localStorage.setItem(LAST_KEY, project.id);
  } catch {
    /* storage may be blocked */
  }
}

const allProjects = async () => (await (await db()).getAll('projects')) as StoredProject[];

/** Projects in use (not in the trash), most recent first. */
export async function listProjects(): Promise<StoredProject[]> {
  return (await allProjects())
    .filter((p) => !p.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Projects in the trash, most recently deleted first. Expired ones are deleted on the way. */
export async function listTrash(): Promise<StoredProject[]> {
  const limit = Date.now() - TRASH_DAYS * 86_400_000;
  const trash: StoredProject[] = [];
  for (const p of await allProjects()) {
    if (!p.deletedAt) continue;
    if (Date.parse(p.deletedAt) < limit) await deleteProject(p.id);
    else trash.push(p);
  }
  return trash.sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!));
}

async function setDeleted(id: string, deletedAt: string | undefined): Promise<void> {
  const d = await db();
  const rec = (await d.get('projects', id)) as StoredProject | undefined;
  if (!rec) return;
  if (deletedAt) rec.deletedAt = deletedAt;
  else delete rec.deletedAt;
  await d.put('projects', rec);
}

/** Moves a project to the trash (it can be restored for {@link TRASH_DAYS} days). */
export const trashProject = (id: string) => setDeleted(id, new Date().toISOString());
export const restoreProject = (id: string) => setDeleted(id, undefined);

export async function loadProject(id: string): Promise<Project | null> {
  const rec = (await (await db()).get('projects', id)) as StoredProject | undefined;
  if (!rec) return null;
  const r = parseProject(rec.project);
  return r.ok ? r.project : null;
}

/** Deletes a project for good. */
export async function deleteProject(id: string): Promise<void> {
  await (await db()).delete('projects', id);
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'projeto';

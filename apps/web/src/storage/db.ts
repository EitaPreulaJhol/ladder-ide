/** Local persistence of working projects (IndexedDB). Nothing leaves the browser unless shared. */
import { openDB, type IDBPDatabase } from 'idb';
import { parseProject, type Project } from '@ladder/core';

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: string;
  project: Project;
}

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

export async function listProjects(): Promise<StoredProject[]> {
  const all = (await (await db()).getAll('projects')) as StoredProject[];
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | null> {
  const rec = (await (await db()).get('projects', id)) as StoredProject | undefined;
  if (!rec) return null;
  const r = parseProject(rec.project);
  return r.ok ? r.project : null;
}

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

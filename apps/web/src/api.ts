import { parseProject, type Project } from '@ladder/core';

export async function createShare(project: Project): Promise<{ id: string }> {
  const res = await fetch('/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchShare(id: string): Promise<Project> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('notFound');
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const body = await res.json();
  const r = parseProject(body.project);
  if (!r.ok) throw new Error(r.error);
  return r.project;
}

export const shareUrl = (id: string) => `${location.origin}/s/${id}`;

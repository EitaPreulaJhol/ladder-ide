import { parseProject, type Project } from '@ladder/core';

export type ExpirationDays = 1 | 7 | 30 | 90 | null;
export type ReportReason = 'spam' | 'offensive' | 'personalData' | 'other';

async function errorOf(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.message || body.error || `Erro ${res.status}`);
}

export async function createShare(
  project: Project,
  expiresInDays: ExpirationDays = null,
): Promise<{ id: string; expiresAt: string | null }> {
  const res = await fetch('/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, expiresInDays }),
  });
  if (!res.ok) throw await errorOf(res);
  return res.json();
}

/** Throws 'notFound', 'expired' or 'hidden' (under review) for unavailable links. */
export async function fetchShare(id: string): Promise<Project> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('notFound');
  if (res.status === 410) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error === 'hidden' ? 'hidden' : 'expired');
  }
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const body = await res.json();
  const r = parseProject(body.project);
  if (!r.ok) throw new Error(r.error);
  return r.project;
}

export async function reportShare(id: string, reason: ReportReason, details: string): Promise<void> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason, details }),
  });
  if (!res.ok) throw await errorOf(res);
}

export const shareUrl = (id: string) => `${location.origin}/s/${id}`;

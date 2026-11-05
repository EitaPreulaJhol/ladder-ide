/** Current drag payload (dataTransfer contents are not readable during dragover). */
export type DragPayload = { kind: 'instr'; instr: string } | { kind: 'node'; rungId: string; nodeId: string };

let current: DragPayload | null = null;

export function setDragPayload(p: DragPayload | null) {
  current = p;
  document.body.classList.toggle('ladder-dragging', p !== null);
}

export const dragPayload = () => current;

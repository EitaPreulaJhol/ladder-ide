import { useProject } from './store/project.ts';

/** Opens the editor on an element (or a rung) and scrolls it into view. */
export function goToElement(programId: string, rungId: string, elementId?: string) {
  const s = useProject.getState();
  if (s.programId !== programId) s.setProgram(programId);
  s.setView('editor');
  s.select({ rungId, nodeId: elementId });
  s.setCursor(null);
  setTimeout(() => {
    const target =
      (elementId && document.querySelector(`[data-el="${CSS.escape(elementId)}"]`)) ||
      document.querySelector(`[data-rung-id="${CSS.escape(rungId)}"]`);
    target?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }, 0);
}

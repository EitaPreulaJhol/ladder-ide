import i18n from 'i18next';
import type { Draft } from 'immer';
import type { Project } from '@ladder/core';
import { useProject } from './project.ts';
import { dismissToast, toast } from './toast.ts';

interface UndoOptions {
  /** Runs after the undo, e.g. to show again what was restored. */
  afterUndo?(): void;
}

interface Description {
  message: string;
  detail?: string;
}

type Describe = string | Description | ((before: Project, after: Project) => Description);

/**
 * Applies an edit right away and shows a toast with "Undo", instead of asking first.
 * The toast goes away as soon as the project changes again: from then on "Undo" would
 * revert a different edit, and Ctrl+Z / the undo button remain available anyway.
 */
export function updateWithUndo(
  recipe: (draft: Draft<Project>) => void,
  describe: Describe,
  opts: UndoOptions = {},
): boolean {
  return runWithUndo(() => useProject.getState().update(recipe), describe, opts);
}

/** Same as {@link updateWithUndo}, for a store action that makes one undoable edit. */
export function runWithUndo(action: () => void, describe: Describe, opts: UndoOptions = {}): boolean {
  const before = useProject.getState().project;
  action();
  const after = useProject.getState().project;
  if (after === before) return false;

  const { message, detail } =
    typeof describe === 'string'
      ? { message: describe }
      : typeof describe === 'function'
        ? describe(before, after)
        : describe;
  let unsubscribe = () => {};
  const id = toast(message, {
    kind: 'success',
    detail,
    action: {
      label: i18n.t('common.undo'),
      run() {
        if (useProject.getState().project !== after) return;
        useProject.getState().undo();
        opts.afterUndo?.();
      },
    },
    onClose: () => unsubscribe(),
  });
  unsubscribe = useProject.subscribe((s) => {
    if (s.project !== after) dismissToast(id);
  });
  return true;
}

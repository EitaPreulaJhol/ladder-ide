import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../store/project.ts';
import { createShare, shareUrl } from '../api.ts';

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const [state, setState] = useState<{
    status: 'idle' | 'busy' | 'done' | 'error';
    url?: string;
    error?: string;
  }>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setState({ status: 'busy' });
    try {
      const { id } = await createShare(project);
      setState({ status: 'done', url: shareUrl(id) });
    } catch (e) {
      setState({ status: 'error', error: (e as Error).message });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{t('share.title')}</h3>
        <p className="muted">{t('share.explain')}</p>
        {state.status === 'done' && state.url ? (
          <div className="share-url">
            <input readOnly value={state.url} onFocus={(e) => e.target.select()} data-testid="share-url" />
            <button
              onClick={async () => {
                await navigator.clipboard?.writeText(state.url!).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? t('share.copied') : t('share.copy')}
            </button>
          </div>
        ) : (
          <button
            className="primary"
            onClick={create}
            disabled={state.status === 'busy'}
            data-testid="create-share"
          >
            {state.status === 'busy' ? t('share.creating') : t('share.create')}
          </button>
        )}
        {state.status === 'error' && <p className="error-text">{t('share.error', { error: state.error })}</p>}
        <div className="modal-actions">
          <button onClick={onClose}>{t('share.close')}</button>
        </div>
      </div>
    </div>
  );
}

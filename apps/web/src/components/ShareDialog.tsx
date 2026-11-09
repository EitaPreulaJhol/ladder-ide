import { useState } from 'react';
import { locale } from '../i18n.ts';
import { useTranslation } from 'react-i18next';
import { useProject } from '../store/project.ts';
import { createShare, shareUrl, type ExpirationDays } from '../api.ts';
import { Modal } from './Modal.tsx';

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const [state, setState] = useState<{
    status: 'idle' | 'busy' | 'done' | 'error';
    url?: string;
    expiresAt?: string | null;
    error?: string;
  }>({ status: 'idle' });
  const [copied, setCopied] = useState(false);
  const [expires, setExpires] = useState<ExpirationDays>(null);

  const create = async () => {
    setState({ status: 'busy' });
    try {
      const { id, expiresAt } = await createShare(project, expires);
      setState({ status: 'done', url: shareUrl(id), expiresAt });
    } catch (e) {
      setState({ status: 'error', error: (e as Error).message });
    }
  };

  return (
    <Modal title={t('share.title')} onClose={onClose}>
      <p className="muted">{t('share.explain')}</p>
      {state.status === 'done' && state.url ? (
        <>
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
          <p className="muted small">
            {state.expiresAt
              ? t('share.expiresOn', { date: new Date(state.expiresAt).toLocaleString(locale()) })
              : t('share.neverExpires')}
          </p>
        </>
      ) : (
        <>
          <label className="field inline">
            <span>{t('share.expiration')}</span>
            <select
              value={expires ?? ''}
              onChange={(e) => setExpires(e.target.value ? (Number(e.target.value) as ExpirationDays) : null)}
              data-testid="share-expiration"
            >
              <option value="">{t('share.never')}</option>
              {[1, 7, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {t('share.days', { count: d })}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            onClick={create}
            disabled={state.status === 'busy'}
            data-testid="create-share"
          >
            {state.status === 'busy' ? t('share.creating') : t('share.create')}
          </button>
        </>
      )}
      <p className="muted small">{t('share.policy')}</p>
      {state.status === 'error' && <p className="error-text">{t('share.error', { error: state.error })}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>{t('share.close')}</button>
      </div>
    </Modal>
  );
}

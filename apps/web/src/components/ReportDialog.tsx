import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reportShare, type ReportReason } from '../api.ts';
import { Modal } from './Modal.tsx';

const REASONS: ReportReason[] = ['spam', 'offensive', 'personalData', 'other'];

/** Report an abusive shared link. Several reports hide the link until an administrator reviews it. */
export function ReportDialog({ shareId, onClose }: { shareId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const send = async () => {
    setState('busy');
    try {
      await reportShare(shareId, reason, details);
      setState('done');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  };

  return (
    <Modal title={t('report.title')} onClose={onClose}>
      {state === 'done' ? (
        <p data-testid="report-done">{t('report.thanks')}</p>
      ) : (
        <>
          <p className="muted small">{t('report.explain')}</p>
          <fieldset className="report-reasons">
            <legend className="sr-only">{t('report.reason')}</legend>
            {REASONS.map((r) => (
              <label key={r} className="check">
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                {t(`report.reasons.${r}`)}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>{t('report.details')}</span>
            <textarea rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <button className="primary" onClick={send} disabled={state === 'busy'} data-testid="report-send">
            {t('report.send')}
          </button>
          {state === 'error' && <p className="error-text">{t('report.error', { error })}</p>}
        </>
      )}
      <div className="modal-actions">
        <button onClick={onClose}>{t('share.close')}</button>
      </div>
    </Modal>
  );
}

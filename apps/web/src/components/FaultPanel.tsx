import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { faultCandidates, kindsFor, type FaultCandidate, type FaultKind } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useSim } from '../store/sim.ts';

/** Label of a fault kind depends on the signal (input sensor vs output device, digital vs analog). */
export function faultLabelKey(c: Pick<FaultCandidate, 'direction' | 'analog'>, kind: FaultKind): string {
  return `faults.kinds.${c.direction}.${c.analog ? 'analog' : 'digital'}.${kind}`;
}

export function FaultPanel() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const faults = useSim((s) => s.faults);
  const event = useSim((s) => s.faultEvent);
  const send = useSim((s) => s.send);
  const candidates = useMemo(() => faultCandidates(project), [project]);
  const [signal, setSignal] = useState('');
  const [kind, setKind] = useState<FaultKind>('stuckOn');
  const [guessSignal, setGuessSignal] = useState('');
  const [guessKind, setGuessKind] = useState<FaultKind>('stuckOn');

  const selected = candidates.find((c) => c.signal === signal);
  const kinds = selected ? kindsFor(selected) : [];
  const guessed = candidates.find((c) => c.signal === guessSignal);
  const guessKinds = guessed ? kindsFor(guessed) : [];

  const options = (onlyDigital: boolean) =>
    (['input', 'output'] as const).map((dir) => (
      <optgroup key={dir} label={t(`faults.${dir}s`)}>
        {candidates
          .filter((c) => c.direction === dir && (!onlyDigital || !c.analog))
          .map((c) => (
            <option key={c.signal} value={c.signal}>
              {c.signal}
            </option>
          ))}
      </optgroup>
    ));

  if (!candidates.length) return <div className="panel-body muted pad">{t('faults.noCandidates')}</div>;

  return (
    <div className="panel-body faults">
      <section>
        <h4>{t('faults.inject')}</h4>
        <p className="muted small">{t('faults.help')}</p>
        <div className="row">
          <select
            value={signal}
            onChange={(e) => {
              setSignal(e.target.value);
              const c = candidates.find((x) => x.signal === e.target.value);
              if (c) setKind(kindsFor(c)[0]!);
            }}
            data-testid="fault-signal"
            aria-label={t('faults.signal')}
          >
            <option value="">{t('faults.signal')}…</option>
            {options(false)}
          </select>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as FaultKind)}
            disabled={!selected}
            data-testid="fault-kind"
            aria-label={t('faults.kind')}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(faultLabelKey(selected!, k))}
              </option>
            ))}
          </select>
          <button
            disabled={!selected}
            onClick={() => send({ type: 'addFault', signal, kind })}
            data-testid="fault-add"
          >
            ⚡ {t('faults.add')}
          </button>
        </div>
        {faults.visible.length > 0 && (
          <ul className="fault-list">
            {faults.visible.map((f) => (
              <li key={f.signal} data-testid={`fault-${f.signal}`}>
                <span className="mono">{f.signal}</span>
                <span>
                  {t(faultLabelKey({ direction: f.direction, analog: typeof f.value === 'number' }, f.kind))}
                </span>
                <button
                  className="icon danger"
                  onClick={() => send({ type: 'removeFault', signal: f.signal })}
                  aria-label={t('faults.remove', { signal: f.signal })}
                >
                  ×
                </button>
              </li>
            ))}
            <li>
              <button className="link" onClick={() => send({ type: 'clearFaults' })}>
                {t('faults.clearAll')}
              </button>
            </li>
          </ul>
        )}
      </section>

      <section className="challenge">
        <h4>🕵 {t('faults.challenge')}</h4>
        {!faults.challenge ? (
          <>
            <p className="muted small">{t('faults.challengeHelp')}</p>
            <button
              className="primary"
              onClick={() => send({ type: 'startChallenge' })}
              data-testid="challenge-start"
            >
              {t('faults.challengeStart')}
            </button>
            {event?.type === 'challengeStarted' && !event.ok && (
              <p className="error-text small">{t('faults.challengeNone')}</p>
            )}
            {event?.type === 'guess' && event.result === 'correct' && (
              <p className="ok-text" data-testid="challenge-result">
                ✓ {t('faults.correct', { attempts: event.attempts })}
              </p>
            )}
            {event?.type === 'revealed' && event.fault && (
              <p className="small" data-testid="challenge-result">
                {t('faults.revealed', {
                  signal: event.fault.signal,
                  kind: t(
                    faultLabelKey(
                      { direction: event.fault.direction, analog: typeof event.fault.value === 'number' },
                      event.fault.kind,
                    ),
                  ),
                })}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="small">{t('faults.challengeActive')}</p>
            <div className="row">
              <select
                value={guessSignal}
                onChange={(e) => {
                  setGuessSignal(e.target.value);
                  setGuessKind('stuckOn');
                }}
                data-testid="guess-signal"
                aria-label={t('faults.signal')}
              >
                <option value="">{t('faults.signal')}…</option>
                {options(true)}
              </select>
              <select
                value={guessKind}
                onChange={(e) => setGuessKind(e.target.value as FaultKind)}
                disabled={!guessed}
                data-testid="guess-kind"
                aria-label={t('faults.kind')}
              >
                {guessKinds.map((k) => (
                  <option key={k} value={k}>
                    {t(faultLabelKey(guessed!, k))}
                  </option>
                ))}
              </select>
              <button
                disabled={!guessed}
                onClick={() => send({ type: 'guessFault', signal: guessSignal, kind: guessKind })}
                data-testid="guess-submit"
              >
                {t('faults.answer')}
              </button>
              <button className="link" onClick={() => send({ type: 'revealFault' })}>
                {t('faults.giveUp')}
              </button>
            </div>
            {event?.type === 'guess' && event.result !== 'correct' && (
              <p className="error-text small" data-testid="challenge-result">
                ✗ {t(`faults.${event.result}`)} · {t('faults.attempts', { n: event.attempts })}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

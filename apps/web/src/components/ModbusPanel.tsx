import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { autoModbusMap, checkModbusMap, isBitArea, modbusReference, type ModbusArea } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { activeMap, useModbus } from '../store/modbus.ts';

const AREAS: ModbusArea[] = ['coil', 'discrete', 'holding', 'input'];

/** The bridge accepts localhost pages; any other origin (hosted IDE) must be authorized with --origin. */
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const BRIDGE_CMD =
  'node apps/bridge/src/index.ts' + (LOCAL.includes(location.hostname) ? '' : ` --origin ${location.origin}`);

export function ModbusPanel() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.update);
  const readOnly = useProject((s) => s.sharedId !== null);
  const { status, error, requests, port: lastPort, connect, disconnect } = useModbus();
  const [port, setPort] = useState(lastPort);
  const [token, setToken] = useState('');
  const map = activeMap(project);
  const custom = !!project.modbus;
  const issues = checkModbusMap(project, map);
  const types = new Map(project.tags.map((tg) => [tg.name, tg.type]));

  return (
    <section className="card modbus no-print" data-testid="modbus">
      <h3>{t('modbus.title')}</h3>
      <p className="muted small">{t('modbus.help')}</p>
      <pre className="modbus-cmd">{BRIDGE_CMD}</pre>
      <p className="muted small">{t('modbus.security')}</p>

      <div className="row modbus-connect">
        <label className="field inline">
          <span>{t('modbus.port')}</span>
          <input
            type="number"
            className="num"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            data-testid="modbus-port"
          />
        </label>
        <label className="field inline">
          <span>{t('modbus.token')}</span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="modbus-token"
          />
        </label>
        {status === 'connected' ? (
          <button onClick={disconnect}>{t('modbus.disconnect')}</button>
        ) : (
          <button
            className="primary"
            onClick={() => connect(port, token)}
            disabled={!token.trim() || status === 'connecting'}
            data-testid="modbus-connect"
          >
            {t('modbus.connect')}
          </button>
        )}
        <span className={`modbus-status ${status}`} data-testid="modbus-status">
          {t(`modbus.status.${status}`)}
          {status === 'connected' && ` · ${t('modbus.requests', { n: requests })}`}
        </span>
      </div>
      {status === 'error' && (
        <p className="error-text small">
          {t(error === 'badToken' || error === 'tooManyAttempts' ? `modbus.${error}` : 'modbus.unreachable')}
        </p>
      )}

      <div className="view-head">
        <h4>{t('modbus.map')}</h4>
        <span className="muted small">{custom ? t('modbus.custom') : t('modbus.auto')}</span>
        <span className="grow" />
        {!readOnly && !custom && (
          <button
            onClick={() => update((d) => void (d.modbus = { map: autoModbusMap(d) }))}
            data-testid="modbus-customize"
          >
            {t('modbus.customize')}
          </button>
        )}
        {!readOnly && custom && (
          <>
            <button onClick={() => update((d) => void (d.modbus = { map: autoModbusMap(d) }))}>
              {t('modbus.regenerate')}
            </button>
            <button onClick={() => update((d) => void delete d.modbus)}>{t('modbus.useAuto')}</button>
          </>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="error-text small">
          {issues.map((i, k) => (
            <li key={k}>{t(`modbus.issue.${i.code}`, { tag: i.tag, other: i.other ?? '' })}</li>
          ))}
        </ul>
      )}
      <table className="grid compact">
        <thead>
          <tr>
            <th>{t('hw.tag')}</th>
            <th>{t('tags.type')}</th>
            <th>{t('modbus.area')}</th>
            <th>{t('modbus.address')}</th>
            <th>{t('modbus.reference')}</th>
          </tr>
        </thead>
        <tbody>
          {map.map((e, i) => (
            <tr key={`${e.tag}-${i}`}>
              <td className="mono">{e.tag}</td>
              <td className="muted">{types.get(e.tag) ?? '?'}</td>
              <td>
                {custom && !readOnly ? (
                  <select
                    value={e.area}
                    onChange={(ev) =>
                      update((d) => void (d.modbus!.map[i]!.area = ev.target.value as ModbusArea))
                    }
                  >
                    {AREAS.filter((a) => isBitArea(a) === (types.get(e.tag) === 'BOOL')).map((a) => (
                      <option key={a} value={a}>
                        {t(`modbus.areas.${a}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  t(`modbus.areas.${e.area}`)
                )}
              </td>
              <td>
                {custom && !readOnly ? (
                  <input
                    type="number"
                    className="num"
                    min={0}
                    max={65535}
                    defaultValue={e.address}
                    key={`${e.tag}-${e.address}`}
                    onBlur={(ev) => {
                      const v = Math.max(0, Math.min(65535, Math.trunc(Number(ev.target.value))));
                      if (v !== e.address) update((d) => void (d.modbus!.map[i]!.address = v));
                    }}
                  />
                ) : (
                  e.address
                )}
              </td>
              <td className="mono muted">{modbusReference(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject, type View } from './store/project.ts';
import { useSim } from './store/sim.ts';
import { useUi } from './store/ui.ts';
import { TopBar } from './components/TopBar.tsx';
import { ReportDialog } from './components/ReportDialog.tsx';
import { LadderEditor, useEditorShortcuts } from './components/editor/LadderEditor.tsx';
import { Properties } from './components/editor/Properties.tsx';
import { BottomPanel } from './components/BottomPanel.tsx';
import { IoPanel } from './components/IoPanel.tsx';
import { PlantView } from './components/PlantView.tsx';
import { TagsView } from './components/TagsView.tsx';
import { HardwareView } from './components/HardwareView.tsx';
import { ProjectsView } from './components/ProjectsView.tsx';
import { DocView } from './components/DocView.tsx';
import { HmiView } from './components/hmi/HmiView.tsx';
import { PlantEditor } from './components/plantBuilder/PlantEditor.tsx';
import { bootShared, forkShared, startAutosave } from './session.ts';
import { WelcomeView } from './components/WelcomeView.tsx';

const NAV: { id: View; icon: string }[] = [
  { id: 'editor', icon: '⊢' },
  { id: 'tags', icon: '#' },
  { id: 'hardware', icon: '▦' },
  { id: 'plant', icon: '⚙' },
  { id: 'hmi', icon: '🖥' },
  { id: 'doc', icon: '🖨' },
  { id: 'projects', icon: '☰' },
];

export function App() {
  const { t } = useTranslation();
  const [boot, setBoot] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({
    status: 'loading',
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const on = () => setUpdateReady(true);
    window.addEventListener('ladder:update', on);
    return () => window.removeEventListener('ladder:update', on);
  }, []);
  const loaded = useProject((s) => s.project !== null);
  const view = useProject((s) => s.view);
  const sharedId = useProject((s) => s.sharedId);
  const hasPlant = useProject((s) => !!(s.project?.scenarioId || s.project?.plant));
  const setView = useProject((s) => s.setView);
  const dock = useUi((s) => s.dock);
  const welcome = useUi((s) => s.welcome);
  const setDock = useUi((s) => s.setDock);
  useEditorShortcuts();

  useEffect(() => {
    const m = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname);
    // Local start: the welcome page chooses what to open. Shared links open directly.
    const p = m ? bootShared(m[1]!) : Promise.resolve();
    p.then(() => setBoot({ status: 'ready' })).catch((e: Error) =>
      setBoot({ status: 'error', error: e.message }),
    );
    const unsub = startAutosave(() => setSavedAt(Date.now()));
    return unsub;
  }, []);

  // Projects with a plant open on the plant tab.
  useEffect(() => {
    if (hasPlant) setDock('plant');
  }, [hasPlant, setDock]);

  // Editing shows properties; starting the simulation brings back the plant / I/O panel.
  const selectedNode = useProject((s) => s.selection?.nodeId);
  const status = useSim((s) => s.status);
  useEffect(() => {
    if (selectedNode && status === 'stopped') setDock('props');
  }, [selectedNode, status, setDock]);
  useEffect(() => {
    if (status === 'running')
      // ...unless the user is reading an explanation ("por que?") in the properties tab.
      setDock((d) =>
        d === 'props' && !useUi.getState().explain
          ? useProject.getState().project.scenarioId || useProject.getState().project.plant
            ? 'plant'
            : 'panel'
          : d,
      );
  }, [status, setDock]);

  if (boot.status === 'error')
    return (
      <div className="boot">
        <p>
          {boot.error === 'notFound' || boot.error === 'expired' || boot.error === 'hidden'
            ? t(`shared.${boot.error}`)
            : t('shared.error', { error: boot.error })}
        </p>
        <a href="/">{t('shared.backHome')}</a>
      </div>
    );
  if (boot.status === 'loading') return <div className="boot">{t('shared.loading')}</div>;
  if (welcome || !loaded) return <WelcomeView />;

  return (
    <div className="app">
      <TopBar savedAt={savedAt} />
      {updateReady && (
        <div className="update-banner" role="status">
          <span>{t('pwa.updateReady')}</span>
          <button className="primary" onClick={() => location.reload()}>
            {t('pwa.reload')}
          </button>
        </div>
      )}
      {sharedId && (
        <div className="shared-banner">
          <span>{t('shared.banner')}</span>
          <button className="primary" onClick={() => void forkShared()} data-testid="fork">
            {t('shared.fork')}
          </button>
          <button className="link" onClick={() => setReporting(true)} data-testid="report">
            {t('report.open')}
          </button>
          {reporting && <ReportDialog shareId={sharedId} onClose={() => setReporting(false)} />}
        </div>
      )}
      <div className="workspace">
        <nav className="sidenav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? 'active' : ''}
              onClick={() => setView(n.id)}
              data-testid={`nav-${n.id}`}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{t(`nav.${n.id}`)}</span>
            </button>
          ))}
        </nav>
        <main className="main">
          <div className="center">
            {view === 'editor' && <LadderEditor />}
            {view === 'tags' && <TagsView />}
            {view === 'hardware' && <HardwareView />}
            {view === 'plant' && <PlantEditor />}
            {view === 'hmi' && <HmiView />}
            {view === 'doc' && <DocView />}
            {view === 'projects' && <ProjectsView />}
          </div>
          <BottomPanel />
        </main>
        <aside className="dock">
          <div className="tabs">
            <button className={dock === 'props' ? 'active' : ''} onClick={() => setDock('props')}>
              {t('props.title')}
            </button>
            <button
              className={dock === 'panel' ? 'active' : ''}
              onClick={() => setDock('panel')}
              data-testid="dock-panel"
            >
              {t('panel.title')}
            </button>
            <button
              className={dock === 'plant' ? 'active' : ''}
              onClick={() => setDock('plant')}
              data-testid="dock-plant"
            >
              {t('plant.title')}
            </button>
          </div>
          <div className="dock-body">
            {dock === 'props' && <Properties />}
            {dock === 'panel' && <IoPanel />}
            {dock === 'plant' && <PlantView />}
          </div>
        </aside>
      </div>
    </div>
  );
}

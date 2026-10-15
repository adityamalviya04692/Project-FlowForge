import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import BottomPanel, { type CodeFile, type PreviewData } from './components/BottomPanel';
import Canvas from './components/Canvas';
import { Icon } from './components/icons';
import Inspector from './components/Inspector';
import Palette, { type Dataset } from './components/Palette';
import { ConfigView, TelemetryView, TerminalView, useDisplaySettings } from './components/WorkstationViews';
import { exportNode, formatOf, preview, registerDataset, wasmExec } from './engine/duckdb';
import { materialize, sourceTable, type NodeState } from './engine/run';
import { makeNode } from './pipeline/catalog';
import { slug, validate } from './pipeline/graph';
import { q } from './pipeline/sql';
import { autoLayout, demoPipeline, emptyPipeline, SAMPLE_DATASETS } from './pipeline/templates';
import type { NodeKind, Pipeline, PNode } from './pipeline/types';

const STORE = 'flowforge:pipeline:v1';

function loadSaved(): Pipeline {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const p = JSON.parse(raw) as Pipeline;
      if (Array.isArray(p.nodes) && Array.isArray(p.edges)) return p;
    }
  } catch {
    /* private mode or corrupt value: fall back to the demo */
  }
  return demoPipeline();
}

function download(name: string, data: string | Uint8Array, type: string) {
  const part = typeof data === 'string' ? data : (new Uint8Array(data) as Uint8Array<ArrayBuffer>);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Only the parts of a pipeline that change its results (not node positions). */
const logicKey = (p: Pipeline) => JSON.stringify([p.nodes.map((n) => [n.id, n.kind, n.config]), p.edges.map((e) => [e.source, e.target, e.targetHandle])]);

export default function App() {
  const [view, setView] = useState<'matrix' | 'terminal' | 'telemetry' | 'config'>('matrix');
  const [dock, setDock] = useState('graph');
  const [resultsCollapsed, setResultsCollapsed] = useState(true);
  const [libraryHidden, setLibraryHidden] = useState(false);
  const [inspectorHidden, setInspectorHidden] = useState(false);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const previousResultsCollapsed = useRef(true);
  const [display, setDisplay] = useDisplaySettings();
  const [clock, setClock] = useState(() => new Date());
  const [pipeline, setPipeline] = useState<Pipeline>(loadSaved);
  const [selected, setSelected] = useState<string | null>(null);
  const [states, setStates] = useState<Map<string, NodeState>>(new Map());
  const [datasets, setDatasets] = useState<Dataset[]>(SAMPLE_DATASETS.map((d) => ({ name: d.name, rows: null, columns: null, origin: 'sample' })));
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [runInfo, setRunInfo] = useState('Starting DuckDB…');
  const [previewData, setPreview] = useState<PreviewData | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [toastMsg, setToast] = useState<string | null>(null);
  const runSeq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const issues = useMemo(() => validate(pipeline), [pipeline]);
  const toast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshDataset = useCallback(async (name: string, origin: Dataset['origin']) => {
    const [r] = await wasmExec.query(`SELECT COUNT(*) AS n FROM ${q(sourceTable(name), 'duckdb')}`);
    const cols = await wasmExec.query(`DESCRIBE ${q(sourceTable(name), 'duckdb')}`);
    setDatasets((ds) => [...ds.filter((d) => d.name !== name), { name, rows: Number(r.n), columns: cols.length, origin }]);
  }, []);

  // Load the bundled samples into DuckDB once.
  useEffect(() => {
    (async () => {
      try {
        for (const d of SAMPLE_DATASETS) {
          const res = await fetch(`${import.meta.env.BASE_URL}sample/${d.file}`);
          await registerDataset(d.name, d.file, new Uint8Array(await res.arrayBuffer()));
          await refreshDataset(d.name, 'sample');
        }
        setReady(true);
      } catch (e) {
        setRunInfo(`Could not start DuckDB: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [refreshDataset]);

  // Re-run whenever the pipeline's logic changes (debounced); dragging nodes does not trigger a run.
  const key = logicKey(pipeline);
  const run = useCallback(async () => {
    const seq = ++runSeq.current;
    setRunning(true);
    const t0 = performance.now();
    const next = await materialize(pipeline, wasmExec);
    if (seq !== runSeq.current) return; // a newer run started meanwhile
    setStates(next);
    setRunning(false);
    const errors = [...next.values()].filter((s) => s.error && s.own).length;
    setRunInfo(`${pipeline.nodes.length} steps ran in ${Math.round(performance.now() - t0)} ms${errors ? ` · ${errors} with errors` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [ready, run]);

  // Autosave (best effort).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (display.autosave) localStorage.setItem(STORE, JSON.stringify(pipeline));
      } catch {
        /* storage unavailable */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [pipeline, display.autosave]);

  // Preview the selected step after each run.
  useEffect(() => {
    const st = selected ? states.get(selected) : undefined;
    if (!selected || !st || st.error) return;
    let live = true;
    preview(selected)
      .then((d) => live && setPreview({ id: selected, ...d }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [selected, states]);

  const addNode = useCallback(
    (kind: NodeKind, pos?: { x: number; y: number }, dataset?: string) => {
      const center = pipeline.nodes.length ? { x: Math.max(...pipeline.nodes.map((n) => n.position.x)) + 260, y: 80 + (pipeline.nodes.length % 5) * 40 } : { x: 80, y: 120 };
      let n = makeNode(kind, pos ?? center);
      if (n.kind === 'source' && dataset) n = { ...n, label: dataset, config: { dataset, table: `raw.${dataset}` } };
      // Clicking a step while another is selected appends it after the selection.
      const after = !pos && selected && kind !== 'source' ? pipeline.nodes.find((x) => x.id === selected && x.kind !== 'output') : undefined;
      const nodes = [...pipeline.nodes, after ? { ...n, position: { x: after.position.x + 260, y: after.position.y } } : n];
      const edges = after ? [...pipeline.edges, { id: `e_${after.id}_${n.id}_in`, source: after.id, target: n.id, targetHandle: kind === 'join' ? 'left' : 'in' }] : pipeline.edges;
      setPipeline({ ...pipeline, nodes, edges });
      setSelected(n.id);
    },
    [pipeline, selected],
  );

  const updateNode = useCallback((n: PNode) => setPipeline((p) => ({ ...p, nodes: p.nodes.map((x) => (x.id === n.id ? n : x)) })), []);
  const deleteNode = useCallback((id: string) => {
    setPipeline((p) => ({ ...p, nodes: p.nodes.filter((n) => n.id !== id), edges: p.edges.filter((e) => e.source !== id && e.target !== id) }));
    setSelected(null);
  }, []);

  const load = (p: Pipeline) => {
    setPipeline(p);
    setSelected(null);
    setStates(new Map());
    setFitKey((k) => k + 1);
  };

  const onUpload = async (files: File[]) => {
    for (const f of files) {
      if (!formatOf(f.name)) {
        toast(`${f.name}: use CSV, Parquet or JSON`);
        continue;
      }
      let name = slug(f.name.replace(/\.[^.]+$/, '')) || 'data';
      while (datasets.some((d) => d.name === name)) name = `${name}_2`;
      try {
        await registerDataset(name, f.name, new Uint8Array(await f.arrayBuffer()));
        await refreshDataset(name, 'upload');
        addNode('source', undefined, name);
        toast(`Loaded ${f.name} as "${name}"`);
      } catch (e) {
        toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const onImport = async (f: File) => {
    try {
      const p = JSON.parse(await f.text()) as Pipeline;
      if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) throw new Error('not a FlowForge pipeline');
      load(p);
    } catch (e) {
      toast(`Could not open ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onDownloadZip = (files: CodeFile[]) => {
    const zip = zipSync(Object.fromEntries(files.map((f) => [`${slug(pipeline.name)}/${f.path}`, strToU8(f.content)])));
    download(`${slug(pipeline.name)}.zip`, zip, 'application/zip');
  };

  const onExport = async (id: string, fmt: 'csv' | 'parquet') => {
    const node = pipeline.nodes.find((n) => n.id === id);
    const bytes = await exportNode(id, fmt);
    download(`${slug(node?.label ?? 'data')}.${fmt}`, bytes, fmt === 'csv' ? 'text/csv' : 'application/octet-stream');
  };

  const node = pipeline.nodes.find((n) => n.id === selected) ?? null;
  const ownErrors = [...states.values()].some((s) => s.error && s.own) || issues.some((i) => i.severity === 'error');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') { e.preventDefault(); if (ready && !running) void run(); }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, running, run]);

  return (
    <div className={`app phosphor-${display.phosphor}${display.scanlines ? ' with-scanlines' : ''}`}>
      <div className="chassis-top"><span className="vent" /><span>FLOWFORGE SYSTEMS // BROWSER WORKSTATION</span><span className="model-badge"><i /> FORGE–80 <small>HIGH-RESOLUTION DATA TERMINAL</small></span><span className="chassis-model">MODEL: FF–8086 · WEB / WASM</span></div>
      <main className={`crt-screen view-${view}${resultsCollapsed ? ' results-collapsed' : ''}`}>
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="7" height="5" rx="1.6" />
              <rect x="14" y="15" width="7" height="5" rx="1.6" />
              <path d="M10 6.5h3.5a2 2 0 0 1 2 2V15" />
            </svg>
          </span>
          <span>FLOWFORGE OS <small>VISUAL DATA WORKSTATION</small></span>
        </span>
        <span className="grow" style={{ display: 'flex', minWidth: 0 }}>
          <span className={`status-pill ${!ready || running ? 'busy' : ownErrors ? 'err' : 'ok'}`} role="status">
            <span className="dot" />
            {!ready ? runInfo : running ? 'Running pipeline…' : runInfo}
          </span>
        </span>
        <button className="btn ghost xs hide-sm" onClick={() => load(autoLayout(pipeline))} disabled={!pipeline.nodes.length} title="Auto-arrange steps">
          <Icon.tidy size={15} /> Tidy
        </button>
        <button className="btn ghost xs hide-sm" onClick={() => fileInput.current?.click()} title="Open a saved pipeline (.json)">
          <Icon.open size={15} /> Open
        </button>
        <button className="btn ghost xs hide-sm" onClick={() => download(`${slug(pipeline.name)}.flowforge.json`, JSON.stringify(pipeline, null, 2), 'application/json')} title="Save the pipeline as JSON">
          <Icon.save size={15} /> Save
        </button>
        <button className="btn primary" onClick={run} disabled={!ready || running}>
          <Icon.play size={13} /> {running ? 'Executing' : '[F5: Execute]'}
        </button>
        <a className="btn ghost xs hide-sm" href="https://github.com/adityamalviya04692/flowforge" target="_blank" rel="noreferrer" title="Source on GitHub" aria-label="Source on GitHub" style={{ padding: 6 }}>
          <Icon.github size={17} />
        </a>
        <input ref={fileInput} type="file" hidden accept=".json" onChange={(e) => (e.target.files?.[0] && onImport(e.target.files[0]), (e.target.value = ''))} />
      </header>
      <nav className="system-nav" aria-label="Workstation views">
        {([['matrix', '01: Canvas matrix'], ['terminal', '02: DuckDB terminal'], ['telemetry', '03: Telemetry logs'], ['config', '04: Config protocol']] as const).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>[{label}]</button>)}
        <span className="nav-state">■ {ready ? 'KERNEL ONLINE' : 'BOOTING KERNEL'}</span>
      </nav>
      <div className="pipeline-bar"><span>&gt;&gt; {view === 'matrix' ? 'ACTIVE_PIPELINE:' : `${view.toUpperCase()}.SYS //`}</span><input className="name-input" value={pipeline.name} onChange={(e) => setPipeline({ ...pipeline, name: e.target.value })} aria-label="Pipeline name" /><span className="pipeline-meta">{pipeline.nodes.length} NODES · {pipeline.edges.length} CIRCUITS · LOCAL EXECUTION</span><span className={ownErrors ? 'warning-text' : 'topology'}>{ownErrors ? 'CHECK TOPOLOGY' : 'TOPOLOGY VALIDATED'} ■</span></div>
      <nav className="mobile-docks" aria-label="Editor panels" hidden={view !== 'matrix'}>{['library', 'graph', 'inspector'].map((id) => <button key={id} className={dock === id ? 'active' : ''} onClick={() => {
        setDock(id);
        if (id !== 'graph') setCanvasOnly(false);
        if (id === 'library') setLibraryHidden(false);
        if (id === 'inspector') setInspectorHidden(false);
      }}>[{id}]</button>)}</nav>
      <div hidden={view !== 'matrix'} className={`workspace dock-${dock}${node ? ' show-inspector' : ''}${libraryHidden || canvasOnly ? ' library-hidden' : ''}${inspectorHidden || canvasOnly ? ' inspector-hidden' : ''}`}>
        <Palette datasets={datasets} onAdd={(k, d) => addNode(k, undefined, d)} onUpload={onUpload} onDemo={() => load(demoPipeline())} onClear={() => load(emptyPipeline())} />
        <div className="center" style={{ position: 'relative' }}>
          <Canvas pipeline={pipeline} states={states} issues={issues} selected={selected} running={running} fitKey={fitKey} onSelect={setSelected} onChange={setPipeline} onAddAt={(k, pos) => addNode(k, pos)} toast={toast} toolbar={<>
            <button className="btn xs column-toggle" aria-expanded={!libraryHidden && !canvasOnly} onClick={() => { setLibraryHidden(!(libraryHidden || canvasOnly)); setCanvasOnly(false); }}>{libraryHidden || canvasOnly ? 'Show toolbox' : 'Hide toolbox'}</button>
            <button className="btn xs column-toggle" aria-expanded={!inspectorHidden && !canvasOnly} onClick={() => { setInspectorHidden(!(inspectorHidden || canvasOnly)); setCanvasOnly(false); }}>{inspectorHidden || canvasOnly ? 'Show inspector' : 'Hide inspector'}</button>
            <button className="btn xs" aria-pressed={canvasOnly} onClick={() => {
              if (!canvasOnly) { previousResultsCollapsed.current = resultsCollapsed; setResultsCollapsed(true); setDock('graph'); }
              else setResultsCollapsed(previousResultsCollapsed.current);
              setCanvasOnly(!canvasOnly);
            }}>{canvasOnly ? 'Restore panels' : 'Canvas only'}</button>
          </>} />
          {toastMsg && <div className="toast" role="alert" key={toastMsg}><Icon.sparkle size={14} style={{ color: 'var(--accent)' }} />{toastMsg}</div>}
        </div>
        <Inspector pipeline={pipeline} node={node} states={states} issues={issues} datasets={datasets} onUpdate={updateNode} onDelete={deleteNode} onRename={(name) => setPipeline({ ...pipeline, name })} onLayout={() => load(autoLayout(pipeline))} />
      </div>
      {view === 'matrix' && <BottomPanel collapsed={resultsCollapsed} onCollapsedChange={setResultsCollapsed} pipeline={pipeline} states={states} issues={issues} selected={selected} preview={previewData} onSelect={setSelected} onExport={onExport} onDownloadZip={onDownloadZip} />}
      {view === 'terminal' && <TerminalView ready={ready} pipeline={pipeline} states={states} />}
      {view === 'telemetry' && <TelemetryView pipeline={pipeline} states={states} running={running} runInfo={runInfo} onSelect={(id) => { setSelected(id); setDock('inspector'); setView('matrix'); }} />}
      {view === 'config' && <ConfigView settings={display} onChange={setDisplay} datasets={datasets} ready={ready} />}
      <footer className="system-footer"><span>DUCKDB / WASM <b>■ {ready ? 'ONLINE' : 'INITIALIZING'}</b></span><span>DATA STAYS IN YOUR BROWSER</span><span>{clock.toLocaleTimeString('en-GB')} · ESC: DESELECT · F5: EXECUTE</span></footer>
      </main>
      <div className="chassis-bottom"><span className="speaker" /><span className="hardware-label">PHONES ○ &nbsp; DEGAUSS ○</span><span className="hardware-dials"><i /> BRIGHT <i /> CONTRAST <i /> H–HOLD</span><span className="power-led" /> <span>POWER</span><span className="power-switch">ON</span></div>
    </div>
  );
}

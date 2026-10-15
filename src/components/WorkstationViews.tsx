import { useEffect, useState, type ReactNode } from 'react';
import { wasmExec, type Row } from '../engine/duckdb';
import { viewName, type NodeState } from '../engine/run';
import { q } from '../pipeline/sql';
import type { Pipeline } from '../pipeline/types';
import type { Dataset } from './Palette';

type DisplaySettings = { phosphor: 'green' | 'amber' | 'white'; scanlines: boolean; autosave: boolean };
const defaults: DisplaySettings = { phosphor: 'green', scanlines: true, autosave: true };

export function useDisplaySettings() {
  const [settings, setSettings] = useState<DisplaySettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('flowforge:display:v1') ?? '{}');
      return { phosphor: ['green', 'amber', 'white'].includes(saved.phosphor) ? saved.phosphor : 'green', scanlines: saved.scanlines !== false, autosave: saved.autosave !== false };
    } catch { return defaults; }
  });
  useEffect(() => { try { localStorage.setItem('flowforge:display:v1', JSON.stringify(settings)); } catch { /* Storage may be unavailable. */ } }, [settings]);
  return [settings, setSettings] as const;
}

function Bay({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`terminal-bay ${className}`}><h2 className="terminal-title">{title}</h2><div className="bay-body">{children}</div></section>;
}

export function TerminalView({ ready, pipeline, states }: { ready: boolean; pipeline: Pipeline; states: Map<string, NodeState> }) {
  const output = pipeline.nodes.find((n) => n.kind === 'output') ?? pipeline.nodes[0];
  const [query, setQuery] = useState(() => output ? `SELECT * FROM ${q(viewName(output.id), 'duckdb')} LIMIT 50;` : 'SHOW TABLES;');
  const [result, setResult] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [plan, setPlan] = useState('Run EXPLAIN to inspect the query plan.');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const execute = async (explain = false) => {
    if (!query.trim() || busy || !ready) return;
    setBusy(true); setError('');
    const start = performance.now();
    try {
      const rows = await wasmExec.query(`${explain ? 'EXPLAIN ' : ''}${query}`);
      if (explain) setPlan(rows.map((r) => String(r.explain_value ?? Object.values(r).join(' '))).join('\n'));
      else { setResult(rows); setColumns(Object.keys(rows[0] ?? {})); }
      if (!explain) setElapsed(performance.now() - start);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="terminal-view">
    <div className="terminal-split">
      <Bay title="‹› Buffer_01 // query.sql">
        <label className="sr-only" htmlFor="sql-buffer">SQL query</label>
        <textarea id="sql-buffer" className="sql-buffer" value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void execute(); } }} />
        <div className="query-actions"><button className="btn primary" disabled={!ready || busy} onClick={() => void execute()}>{busy ? 'Executing…' : '▶ Execute query'}</button><button className="btn" disabled={!ready || busy} onClick={() => void execute(true)}>Explain</button><span>⌘ / CTRL + ENTER</span></div>
      </Bay>
      <Bay title="▦ Explain // query plan"><pre className="query-plan">{plan}</pre><div className="terminal-note">Queries run against the current in-memory DuckDB session. Pipeline views are available after execution.</div></Bay>
    </div>
    <Bay title={`Result_set // ${result.length} ROWS${elapsed !== null ? ` · ${elapsed.toFixed(2)} MS` : ''}`} className="query-results">
      {error ? <p className="query-error" role="alert">[ERROR] {error}</p> : columns.length ? <table className="grid"><thead><tr><th>#HEX</th>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{result.map((r, i) => <tr key={i}><td className="muted">0x{i.toString(16).padStart(4, '0')}</td>{columns.map((c) => <td key={c}>{r[c] == null ? 'NULL' : String(r[c])}</td>)}</tr>)}</tbody></table> : <p className="muted">{elapsed === null ? '> Ready for a query. Select a table below or type SQL to begin.' : '> Query completed. No rows returned.'}</p>}
    </Bay>
    <div className="query-macros"><span>QUICK_MACROS:</span><button className="btn xs" onClick={() => setQuery('SHOW TABLES;')}>Show tables</button>{pipeline.nodes.filter((n) => states.has(n.id) && !states.get(n.id)?.error).map((n) => <button key={n.id} className="btn xs" onClick={() => setQuery(`SELECT * FROM ${q(viewName(n.id), 'duckdb')} LIMIT 50;`)}>{n.label}</button>)}</div>
  </div>;
}

export function TelemetryView({ pipeline, states, running, runInfo, onSelect }: { pipeline: Pipeline; states: Map<string, NodeState>; running: boolean; runInfo: string; onSelect: (id: string) => void }) {
  const all = [...states.values()];
  const success = all.filter((s) => s.rows !== undefined && !s.error).length;
  const ms = all.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  const maxMs = Math.max(1, ...all.map((s) => s.ms ?? 0));
  const checks = all.flatMap((s) => s.quality?.checks ?? []);
  const failed = checks.filter((c) => c.failed > 0).length;
  return <div className="telemetry-view">
    <div className="telemetry-cards">
      <Bay title="▦ Pipeline execution"><div className="telemetry-value">{success.toString().padStart(2, '0')}<small> / {pipeline.nodes.length} NODES</small></div><div className="segment-meter" style={{ ['--fill' as string]: `${pipeline.nodes.length ? success / pipeline.nodes.length * 100 : 0}%` }} /><p className="muted">{running ? 'EXECUTING' : 'LAST EXECUTION'}</p></Bay>
      <Bay title="◷ Aggregate latency"><div className="telemetry-value">{ms.toFixed(1)}<small> MS</small></div><p className="muted">Measured across pipeline steps</p></Bay>
      <Bay title="◇ Quality assertions"><div className={`telemetry-value${failed ? ' warning-text' : ''}`}>{checks.length - failed}<small> / {checks.length} PASS</small></div><p className="muted">{failed ? `${failed} CHECKS NEED ATTENTION` : 'NO FAILING CHECKS'}</p></Bay>
      <Bay title="⇄ Execution target"><div className="engine-readout">DUCKDB / WASM</div><p className="muted">IN-MEMORY · BROWSER LOCAL</p><div className="engine-lines"><span>TRANSPORT</span><b>ZERO UPLOAD</b><span>DATASETS</span><b>{pipeline.nodes.filter((n) => n.kind === 'source').length} SOURCES</b></div></Bay>
    </div>
    <Bay title="▤ Active pipeline node matrix">
      <table className="grid telemetry-table"><thead><tr><th>HEX_ID</th><th>NODE IDENTIFIER</th><th>STAGE ROLE</th><th>STATUS</th><th>ROWS</th><th>LATENCY</th><th>RELATIVE DURATION</th></tr></thead><tbody>{pipeline.nodes.map((n, i) => { const s = states.get(n.id); return <tr key={n.id}><td className="muted">0x{i.toString(16).padStart(2, '0')}</td><td><button className="text-button" onClick={() => onSelect(n.id)}>▸ {n.label}</button></td><td>{n.kind.toUpperCase()}</td><td className={s?.error ? 'warning-text' : ''}>[{s?.error ? 'ERROR' : s ? 'ONLINE' : 'WAITING'}]</td><td>{s?.rows?.toLocaleString() ?? '—'}</td><td>{s?.ms?.toFixed(2) ?? '—'} ms</td><td><div className="duration-bar"><span style={{ width: `${(s?.ms ?? 0) / maxMs * 100}%` }} /></div></td></tr>; })}</tbody></table>
    </Bay>
    <Bay title="Stdout:// execution_events"><p className="execution-summary">&gt; {runInfo}</p><div className="execution-events">{pipeline.nodes.map((n) => { const s = states.get(n.id); return <p key={n.id} className={s?.error ? 'warning-text' : ''}><span>{s?.error ? '[ERROR]' : s ? '[ INFO]' : '[ WAIT]'}</span> {n.label}: {s?.error ?? (s ? `${s.rows?.toLocaleString() ?? 0} rows materialized in ${s.ms?.toFixed(2) ?? '—'} ms` : 'Awaiting execution')}</p>; })}</div></Bay>
  </div>;
}

export function ConfigView({ settings, onChange, datasets, ready }: { settings: DisplaySettings; onChange: (settings: DisplaySettings) => void; datasets: Dataset[]; ready: boolean }) {
  return <div className="config-view">
    <Bay title="01: Engine & compute"><div className="config-block"><span className="config-label">EXECUTION_ENGINE_CORE</span><div className="config-choice active">[●] Vectorized DuckDB WASM</div><p className="muted">Queries execute locally in your browser using the bundled WebAssembly engine.</p></div><div className="engine-lines"><span>KERNEL STATUS</span><b>{ready ? 'ONLINE' : 'INITIALIZING'}</b><span>EXECUTION MODE</span><b>IN-MEMORY</b><span>EXPORT TARGETS</span><b>SQL / PYSPARK / DBT</b></div></Bay>
    <Bay title="02: Storage & session"><div className="config-block"><span className="config-label">PIPELINE_PERSISTENCE</span><label className="toggle-row"><span>Autosave pipeline locally<small>Restore your graph on the next visit.</small></span><input type="checkbox" checked={settings.autosave} onChange={(e) => onChange({ ...settings, autosave: e.target.checked })} /></label><p className="muted">File data stays in this session. Re-upload your own datasets after a reload.</p></div><div className="config-block"><span className="config-label">DATASET_REGISTRY</span>{datasets.map((d) => <div className="registry-row" key={d.name}><span>{d.name}</span><span>{d.rows?.toLocaleString() ?? '…'} ROWS</span></div>)}</div></Bay>
    <Bay title="03: CRT & phosphor optics"><div className="config-block"><span className="config-label">PHOSPHOR_EMISSION_SPECTRUM</span>{(['green', 'amber', 'white'] as const).map((color) => <label className={`config-choice${settings.phosphor === color ? ' active' : ''}`} key={color}><input type="radio" name="phosphor" value={color} checked={settings.phosphor === color} onChange={() => onChange({ ...settings, phosphor: color })} /> {color === 'green' ? 'P1 Green / classic' : color === 'amber' ? 'P3 Amber / warm' : 'P4 White / monochrome'}</label>)}</div><label className="toggle-row"><span>CRT scanlines<small>Subtle texture over the screen.</small></span><input type="checkbox" checked={settings.scanlines} onChange={(e) => onChange({ ...settings, scanlines: e.target.checked })} /></label><div className="convergence-test" aria-hidden="true">＋<span>CONVERGENCE_TEST // CROSSHATCH_OK</span></div><button className="btn" onClick={() => onChange(defaults)}>Reset display defaults</button><p className="muted">Preferences apply immediately and save in this browser.</p></Bay>
  </div>;
}

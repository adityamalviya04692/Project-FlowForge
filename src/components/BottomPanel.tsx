import { useMemo, useState } from 'react';
import { columnNames, type NodeState } from '../engine/run';
import type { Row } from '../engine/duckdb';
import { toDbt } from '../pipeline/dbt';
import type { Issue } from '../pipeline/graph';
import { toPySpark } from '../pipeline/pyspark';
import { compileScript } from '../pipeline/sql';
import type { Pipeline } from '../pipeline/types';
import CodeView from './CodeView';
import { Icon } from './icons';

type Tab = 'data' | 'code' | 'quality' | 'problems';

export interface PreviewData {
  id: string;
  columns: string[];
  rows: Row[];
}

export interface CodeFile {
  path: string;
  content: string;
  lang: 'sql' | 'python' | 'text';
}

export function generateAll(p: Pipeline, states: Map<string, NodeState>): CodeFile[] {
  const cols = columnNames(states);
  return [
    { path: 'sql/duckdb.sql', content: compileScript(p, cols, 'duckdb'), lang: 'sql' },
    { path: 'sql/spark.sql', content: compileScript(p, cols, 'spark'), lang: 'sql' },
    { path: 'pyspark/job.py', content: toPySpark(p, cols), lang: 'python' },
    ...toDbt(p, cols).map((f) => ({ path: `dbt/${f.path}`, content: f.content, lang: (f.path.endsWith('.sql') ? 'sql' : 'text') as CodeFile['lang'] })),
    { path: 'pipeline.json', content: JSON.stringify(p, null, 2), lang: 'text' },
  ];
}

export default function BottomPanel({ pipeline, states, issues, selected, preview, onSelect, onExport, onDownloadZip }: { pipeline: Pipeline; states: Map<string, NodeState>; issues: Issue[]; selected: string | null; preview: PreviewData | null; onSelect: (id: string) => void; onExport: (id: string, fmt: 'csv' | 'parquet') => void; onDownloadZip: (files: CodeFile[]) => void }) {
  const [tab, setTab] = useState<Tab>('data');
  const [file, setFile] = useState('sql/duckdb.sql');
  const files = useMemo(() => (tab === 'code' ? generateAll(pipeline, states) : []), [tab, pipeline, states]);
  const current = files.find((f) => f.path === file) ?? files[0];
  const node = pipeline.nodes.find((n) => n.id === selected);
  const st = selected ? states.get(selected) : undefined;
  const qualityNodes = pipeline.nodes.filter((n) => n.kind === 'quality');
  const failedTotal = qualityNodes.reduce((s, n) => s + (states.get(n.id)?.quality?.checks.reduce((x, c) => x + c.failed, 0) ?? 0), 0);
  const problems = [
    ...issues,
    ...[...states].filter(([id, s]) => s.error && s.own && !issues.some((i) => i.nodeId === id)).map(([id, s]) => ({ nodeId: id, severity: 'error' as const, message: s.error! })),
  ];
  const label = (id: string) => pipeline.nodes.find((n) => n.id === id)?.label ?? 'Pipeline';

  return (
    <section className="bottom" aria-label="Results">
      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><Icon.table size={15} /> Data</button>
        <button role="tab" className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}><Icon.code size={15} /> Code</button>
        <button role="tab" className={tab === 'quality' ? 'active' : ''} onClick={() => setTab('quality')}>
          <Icon.sparkle size={15} /> Quality {failedTotal > 0 && <span className="count bad">{failedTotal.toLocaleString('en-US')}</span>}
        </button>
        <button role="tab" className={tab === 'problems' ? 'active' : ''} onClick={() => setTab('problems')}>
          <Icon.alert size={15} /> Problems {problems.length > 0 && <span className={`count${problems.some((p) => p.severity === 'error') ? ' bad' : ''}`}>{problems.length}</span>}
        </button>
        <span className="spacer" />
        {tab === 'data' && node && st && !st.error && (
          <span className="row">
            <button className="btn ghost xs" onClick={() => onExport(node.id, 'csv')}><Icon.download size={14} /> CSV</button>
            <button className="btn ghost xs" onClick={() => onExport(node.id, 'parquet')}>Parquet</button>
          </span>
        )}
        {tab === 'code' && (
          <span className="row">
            <button className="btn ghost xs" onClick={() => current && navigator.clipboard.writeText(current.content).catch(() => undefined)}><Icon.copy size={14} /> Copy</button>
            <button className="btn primary xs" onClick={() => onDownloadZip(files)}><Icon.download size={14} /> Download project (.zip)</button>
          </span>
        )}
      </div>
      <div className="tab-body" key={tab}>
        {tab === 'data' &&
          (!node ? (
            <p className="muted">Select a step to preview its output.</p>
          ) : st?.error ? (
            <p className="muted">{node.label}: {st.error}</p>
          ) : preview && preview.id === node.id ? (
            <>
              <p className="preview-head muted">
                <span className={`pill ok`}><span className="dot" />{node.label}</span> showing {preview.rows.length} of {(st?.rows ?? 0).toLocaleString('en-US')} rows
              </p>
              <table className="grid">
                <thead>
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c}>
                        {c}
                        <span className="ty">{st?.columns.find((x) => x.name === c)?.type.toLowerCase()}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      {preview.columns.map((c) => {
                        const v = r[c];
                        return v == null ? <td key={c} className="null">null</td> : <td key={c} className={typeof v === 'number' ? 'num' : ''} title={String(v)}>{typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div>{[80, 60, 70, 50].map((w) => <div key={w} className="skeleton" style={{ width: `${w}%` }} />)}</div>
          ))}
        {tab === 'code' && current && (
          <div className="code-layout">
            <div className="code-files" role="listbox" aria-label="Generated files">
              {files.map((f) => (
                <button key={f.path} className={f.path === current.path ? 'active' : ''} onClick={() => setFile(f.path)} role="option" aria-selected={f.path === current.path}>
                  {f.path}
                </button>
              ))}
            </div>
            <CodeView code={current.content} lang={current.lang} />
          </div>
        )}
        {tab === 'quality' &&
          (qualityNodes.length === 0 ? (
            <p className="muted">Add a Quality check step to assert not-null, unique, ranges, accepted values or patterns.</p>
          ) : (
            qualityNodes.map((n) => {
              const q = states.get(n.id)?.quality;
              return (
                <div key={n.id} style={{ marginBottom: 12 }}>
                  <button className="icon-btn" style={{ color: 'var(--text)', fontWeight: 700, padding: 0 }} onClick={() => onSelect(n.id)}>{n.label}</button>
                  {q ? (
                    <table className="grid" style={{ marginTop: 4 }}>
                      <thead><tr><th>Check</th><th>Failing rows</th><th>Share</th></tr></thead>
                      <tbody>
                        {q.checks.map((c) => (
                          <tr key={c.label}>
                            <td className="mono">{c.label}</td>
                            <td className="num" style={{ color: c.failed ? 'var(--bad)' : 'var(--good)' }}>{c.failed ? c.failed.toLocaleString('en-US') : '✓ 0'}</td>
                            <td className="num">{q.total ? `${((c.failed / q.total) * 100).toFixed(2)}%` : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="small muted">Not run yet.</p>
                  )}
                </div>
              );
            })
          ))}
        {tab === 'problems' &&
          (problems.length === 0 ? (
            <p style={{ color: 'var(--good)' }}>✓ No problems. Every step is configured and runs.</p>
          ) : (
            problems.map((p, i) => (
              <div key={i} className="problem" onClick={() => p.nodeId && onSelect(p.nodeId)}>
                <b style={{ color: p.severity === 'error' ? 'var(--bad)' : 'var(--warn)' }}>{p.severity}</b>
                <span className="small muted">{label(p.nodeId)}</span>
                <span>{p.message}</span>
              </div>
            ))
          ))}
      </div>
    </section>
  );
}

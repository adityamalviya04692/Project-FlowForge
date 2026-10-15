import { useRef, useState } from 'react';
import { KIND_ORDER, NODE_DEFS } from '../pipeline/catalog';
import type { NodeKind } from '../pipeline/types';
import { Icon, KindIcon } from './icons';

export interface Dataset {
  name: string;
  rows: number | null;
  columns: number | null;
  origin: 'sample' | 'upload';
}

export const DRAG_TYPE = 'application/x-flowforge-node';

export default function Palette({ datasets, onAdd, onUpload, onDemo, onClear }: { datasets: Dataset[]; onAdd: (kind: NodeKind, dataset?: string) => void; onUpload: (files: File[]) => void; onDemo: () => void; onClear: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const kinds = KIND_ORDER.filter((k) => !q || `${NODE_DEFS[k].label} ${NODE_DEFS[k].blurb} ${NODE_DEFS[k].group}`.toLowerCase().includes(q));
  const groups = [...new Set(kinds.map((k) => NODE_DEFS[k].group))];
  return (
    <aside className="panel palette" aria-label="Node palette">
      <div className="terminal-title">▦ Toolbox // step_library <span>12 MOD</span></div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="btn soft xs grow" onClick={onDemo}>
          <Icon.sparkle size={14} /> Load demo
        </button>
        <button className="btn ghost xs" onClick={onClear}>New empty</button>
      </div>
      <label className="search">
        <Icon.search size={15} />
        <input placeholder="> FILTER_STEPS…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search steps" />
      </label>
      {groups.map((g) => (
        <div key={g}>
          <div className="section-title">{g}</div>
          <div className="tiles">
            {kinds
              .filter((k) => NODE_DEFS[k].group === g)
              .map((k, i) => {
                const d = NODE_DEFS[k];
                return (
                  <button
                    key={k}
                    className={`tile cat-${d.group.toLowerCase()}`}
                    style={{ animation: `fade-up 0.3s var(--ease) ${i * 30}ms both` }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, k);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onAdd(k)}
                    title={`${d.blurb}. Drag onto the canvas, or click to add.`}
                  >
                    <span className="icon-tile"><KindIcon kind={k} size={15} /></span>
                    <span className="t">{d.label}</span>
                    <span className="tile-detail">{d.blurb}</span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      {!kinds.length && <p className="drop-note">No step matches “{query}”.</p>}
      <div>
        <div className="section-title">Datasets</div>
        <div className="datasets">
          {datasets.map((d) => (
            <button key={d.name} className="ds" onClick={() => onAdd('source', d.name)} title={`Add as a Source step. ${d.origin === 'upload' ? 'Uploaded file (stays in this browser).' : 'Bundled sample.'}`}>
              <span className="icon-tile cat-input" style={{ width: 22, height: 22, borderRadius: 6 }}><KindIcon kind="source" size={13} /></span>
              <span className="n">{d.name}</span>
              <span className="c">{d.rows != null ? `${d.rows.toLocaleString('en-US')} rows` : '…'}</span>
            </button>
          ))}
          <button className="btn ghost xs" style={{ justifyContent: 'flex-start', border: '1px dashed var(--border-strong)' }} onClick={() => file.current?.click()}>
            <Icon.upload size={14} /> Upload CSV / Parquet / JSON
          </button>
        </div>
        <input ref={file} type="file" hidden multiple accept=".csv,.tsv,.txt,.parquet,.pq,.json,.jsonl,.ndjson" onChange={(e) => (onUpload([...(e.target.files ?? [])]), (e.target.value = ''))} />
        <p className="drop-note" style={{ marginTop: 8 }}>Files are processed in your browser and never uploaded.</p>
      </div>
    </aside>
  );
}

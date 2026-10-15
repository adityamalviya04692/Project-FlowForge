import { useRef } from 'react';
import { KIND_ORDER, NODE_DEFS } from '../pipeline/catalog';
import type { NodeKind } from '../pipeline/types';

export interface Dataset {
  name: string;
  rows: number | null;
  columns: number | null;
  origin: 'sample' | 'upload';
}

export const DRAG_TYPE = 'application/x-flowforge-node';

export default function Palette({ datasets, onAdd, onUpload, onDemo, onClear }: { datasets: Dataset[]; onAdd: (kind: NodeKind, dataset?: string) => void; onUpload: (files: File[]) => void; onDemo: () => void; onClear: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const groups = [...new Set(KIND_ORDER.map((k) => NODE_DEFS[k].group))];
  return (
    <aside className="panel palette" aria-label="Node palette">
      <div>
        <div className="section-title">Start</div>
        <div className="row">
          <button className="btn xs" onClick={onDemo}>Load demo</button>
          <button className="btn quiet xs" onClick={onClear}>New empty</button>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <div className="section-title">{g}</div>
          {KIND_ORDER.filter((k) => NODE_DEFS[k].group === g).map((k) => {
            const d = NODE_DEFS[k];
            return (
              <button
                key={k}
                className="pal-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, k);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => onAdd(k)}
                title="Drag onto the canvas, or click to add"
              >
                <span className={`glyph g-${d.group}`}>{d.glyph}</span>
                <span>
                  <div className="t">{d.label}</div>
                  <div className="d">{d.blurb}</div>
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <div>
        <div className="section-title">Datasets</div>
        {datasets.map((d) => (
          <div key={d.name} className="ds" title={d.origin === 'upload' ? 'Uploaded file (stays in this browser)' : 'Bundled sample'}>
            <button className="icon-btn mono" style={{ padding: 0, color: 'var(--text)' }} onClick={() => onAdd('source', d.name)} title="Add as a Source node">
              {d.name}
            </button>
            <span className="muted">{d.rows != null ? `${d.rows.toLocaleString('en-US')} rows` : '…'}</span>
          </div>
        ))}
        <button className="btn ghost xs" style={{ marginTop: 4 }} onClick={() => file.current?.click()}>
          + Upload CSV / Parquet / JSON
        </button>
        <input ref={file} type="file" hidden multiple accept=".csv,.tsv,.txt,.parquet,.pq,.json,.jsonl,.ndjson" onChange={(e) => (onUpload([...(e.target.files ?? [])]), (e.target.value = ''))} />
        <p className="small muted" style={{ marginTop: 6 }}>Files are processed in your browser and never uploaded.</p>
      </div>
    </aside>
  );
}

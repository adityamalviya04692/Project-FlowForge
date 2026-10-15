import { Icon, KindIcon } from './icons';
import type { ReactNode } from 'react';
import type { NodeState } from '../engine/run';
import { NODE_DEFS } from '../pipeline/catalog';
import { inputsOf, type Issue } from '../pipeline/graph';
import type { AggFn, Configs, Op, Pipeline, PNode, QRule, WinFn } from '../pipeline/types';
import type { Dataset } from './Palette';

const OPS: { id: Op; label: string }[] = [
  { id: '=', label: '=' }, { id: '!=', label: '≠' }, { id: '>', label: '>' }, { id: '>=', label: '≥' }, { id: '<', label: '<' }, { id: '<=', label: '≤' },
  { id: 'contains', label: 'contains' }, { id: 'starts_with', label: 'starts with' }, { id: 'in', label: 'in list' }, { id: 'is_null', label: 'is empty' }, { id: 'not_null', label: 'is not empty' },
];
const AGGS: AggFn[] = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'];
const WINS: WinFn[] = ['row_number', 'rank', 'dense_rank', 'running_sum', 'lag', 'lead'];
const RULES: { id: QRule; label: string }[] = [
  { id: 'not_null', label: 'not null' }, { id: 'unique', label: 'unique' }, { id: 'between', label: 'between' }, { id: 'accepted_values', label: 'accepted values' }, { id: 'matches', label: 'matches regex' },
];
const CASTS = ['', 'VARCHAR', 'INTEGER', 'BIGINT', 'DOUBLE', 'DECIMAL(12,2)', 'DATE', 'TIMESTAMP', 'BOOLEAN'];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function ColSelect({ value, cols, onChange, allowEmpty }: { value: string; cols: string[]; onChange: (v: string) => void; allowEmpty?: string }) {
  const options = value && !cols.includes(value) ? [value, ...cols] : cols;
  return (
    <select className="in" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowEmpty ?? '— column —'}</option>
      {options.map((c) => (
        <option key={c} value={c}>{c}{cols.includes(c) ? '' : ' (missing)'}</option>
      ))}
    </select>
  );
}

function ColChips({ value, cols, onChange }: { value: string[]; cols: string[]; onChange: (v: string[]) => void }) {
  if (!cols.length) return <p className="small muted">Connect an input to pick columns.</p>;
  return (
    <div className="chips">
      {cols.map((c) => (
        <button key={c} type="button" className={`chip${value.includes(c) ? ' on' : ''}`} onClick={() => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c])}>
          {c}
        </button>
      ))}
    </div>
  );
}

function Rows<T>({ items, onChange, make, render, addLabel }: { items: T[]; onChange: (v: T[]) => void; make: () => T; render: (item: T, set: (v: T) => void) => ReactNode; addLabel: string }) {
  return (
    <div className="list">
      {items.map((it, i) => (
        <div key={i} className="list-row" style={{ gridTemplateColumns: '1fr auto' }}>
          <div className="list">{render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}</div>
          <button className="icon-btn" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn ghost xs" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...items, make()])}>+ {addLabel}</button>
    </div>
  );
}

function ConfigForm({ n, inCols, datasets, set }: { n: PNode; inCols: string[][]; datasets: Dataset[]; set: (c: Partial<Configs[PNode['kind']]>) => void }) {
  const [a = [], b = []] = inCols;
  switch (n.kind) {
    case 'source':
      return (
        <>
          <Field label="Dataset">
            <select className="in" value={n.config.dataset} onChange={(e) => set({ dataset: e.target.value })}>
              <option value="">— choose —</option>
              {datasets.map((d) => (
                <option key={d.name} value={d.name}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Table name in generated code">
            <input className="in mono" value={n.config.table} onChange={(e) => set({ table: e.target.value })} />
          </Field>
        </>
      );
    case 'filter':
      return (
        <>
          <Field label="Keep rows where">
            <select className="in" value={n.config.match} onChange={(e) => set({ match: e.target.value as 'all' | 'any' })}>
              <option value="all">all conditions match (AND)</option>
              <option value="any">any condition matches (OR)</option>
            </select>
          </Field>
          <Rows
            items={n.config.conditions}
            onChange={(conditions) => set({ conditions })}
            make={() => ({ column: '', op: '=' as Op, value: '' })}
            addLabel="condition"
            render={(c, upd) => (
              <>
                <ColSelect value={c.column} cols={a} onChange={(column) => upd({ ...c, column })} />
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <select className="in" style={{ width: 110 }} value={c.op} onChange={(e) => upd({ ...c, op: e.target.value as Op })}>
                    {OPS.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  {!['is_null', 'not_null'].includes(c.op) && <input className="in" placeholder={c.op === 'in' ? 'a, b, c' : 'value'} value={c.value} onChange={(e) => upd({ ...c, value: e.target.value })} />}
                </div>
              </>
            )}
          />
        </>
      );
    case 'select': {
      const chosen = new Map(n.config.columns.map((c) => [c.name, c]));
      return (
        <>
          <div className="row">
            <button className="btn ghost xs" onClick={() => set({ columns: a.map((name) => chosen.get(name) ?? { name, as: '', cast: '' }) })}>All</button>
            <button className="btn ghost xs" onClick={() => set({ columns: [] })}>None</button>
          </div>
          <div className="list">
            {a.map((name) => {
              const c = chosen.get(name);
              const upd = (patch: Partial<{ as: string; cast: string }>) => set({ columns: n.config.columns.map((x) => (x.name === name ? { ...x, ...patch } : x)) });
              return (
                <div key={name} className="list-row" style={{ gridTemplateColumns: 'auto 1fr' }}>
                  <input type="checkbox" checked={!!c} onChange={(e) => set({ columns: e.target.checked ? a.filter((x) => x === name || chosen.has(x)).map((x) => chosen.get(x) ?? { name: x, as: '', cast: '' }) : n.config.columns.filter((x) => x.name !== name) })} aria-label={`Keep ${name}`} />
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <span className="mono small" style={{ minWidth: 90 }}>{name}</span>
                    {c && (
                      <>
                        <input className="in" placeholder="rename" value={c.as} onChange={(e) => upd({ as: e.target.value })} />
                        <select className="in" style={{ width: 96 }} value={c.cast} onChange={(e) => upd({ cast: e.target.value })}>
                          {CASTS.map((t) => (
                            <option key={t} value={t}>{t || 'type'}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      );
    }
    case 'derive':
      return (
        <>
          <Rows
            items={n.config.columns}
            onChange={(columns) => set({ columns })}
            make={() => ({ name: '', expr: '' })}
            addLabel="column"
            render={(c, upd) => (
              <>
                <input className="in mono" placeholder="column name" value={c.name} onChange={(e) => upd({ ...c, name: e.target.value })} />
                <textarea className="in" placeholder="SQL expression, e.g. quantity * unit_price" value={c.expr} onChange={(e) => upd({ ...c, expr: e.target.value })} />
              </>
            )}
          />
          <p className="small muted">Expressions are SQL and run unchanged in DuckDB, Spark SQL (F.expr) and dbt. Available: <span className="mono">{a.join(', ')}</span></p>
        </>
      );
    case 'join':
      return (
        <>
          <Field label="Join type">
            <select className="in" value={n.config.how} onChange={(e) => set({ how: e.target.value as Configs['join']['how'] })}>
              <option value="inner">inner: only matching rows</option>
              <option value="left">left: keep every left row</option>
              <option value="right">right: keep every right row</option>
              <option value="full">full: keep everything</option>
            </select>
          </Field>
          <span className="lbl">Keys (left = right)</span>
          <Rows
            items={n.config.keys}
            onChange={(keys) => set({ keys })}
            make={() => ({ left: '', right: '' })}
            addLabel="key"
            render={(k, upd) => (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <ColSelect value={k.left} cols={a} onChange={(left) => upd({ left, right: k.right || (b.includes(left) ? left : '') })} allowEmpty="left" />
                <span>=</span>
                <ColSelect value={k.right} cols={b} onChange={(right) => upd({ ...k, right })} allowEmpty="right" />
              </div>
            )}
          />
          <p className="small muted">Same-named keys appear once; other clashing right-side columns get a _right suffix.</p>
        </>
      );
    case 'aggregate':
      return (
        <>
          <Field label="Group by">
            <ColChips value={n.config.groupBy} cols={a} onChange={(groupBy) => set({ groupBy })} />
          </Field>
          <span className="lbl">Measures</span>
          <Rows
            items={n.config.aggs}
            onChange={(aggs) => set({ aggs })}
            make={() => ({ fn: 'sum' as AggFn, column: '', as: '' })}
            addLabel="measure"
            render={(x, upd) => (
              <>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <select className="in" style={{ width: 130 }} value={x.fn} onChange={(e) => upd({ ...x, fn: e.target.value as AggFn })}>
                    {AGGS.map((f) => (
                      <option key={f} value={f}>{f.replace('_', ' ')}</option>
                    ))}
                  </select>
                  <ColSelect value={x.column} cols={a} onChange={(column) => upd({ ...x, column, as: x.as || `${x.fn}_${column}` })} allowEmpty={x.fn === 'count' ? '* (all rows)' : undefined} />
                </div>
                <input className="in mono" placeholder="output name" value={x.as} onChange={(e) => upd({ ...x, as: e.target.value })} />
              </>
            )}
          />
        </>
      );
    case 'dedupe':
      return (
        <>
          <Field label="One row per">
            <ColChips value={n.config.keys} cols={a} onChange={(keys) => set({ keys })} />
          </Field>
          <Field label="Keep the row with the">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select className="in" style={{ width: 100 }} value={n.config.desc ? 'desc' : 'asc'} onChange={(e) => set({ desc: e.target.value === 'desc' })}>
                <option value="desc">latest</option>
                <option value="asc">earliest</option>
              </select>
              <ColSelect value={n.config.orderBy} cols={a} onChange={(orderBy) => set({ orderBy })} />
            </div>
          </Field>
        </>
      );
    case 'window':
      return (
        <>
          <Field label="Function">
            <select className="in" value={n.config.fn} onChange={(e) => set({ fn: e.target.value as WinFn })}>
              {WINS.map((f) => (
                <option key={f} value={f}>{f.replace('_', ' ')}</option>
              ))}
            </select>
          </Field>
          {['running_sum', 'lag', 'lead'].includes(n.config.fn) && (
            <Field label="Of column">
              <ColSelect value={n.config.column} cols={a} onChange={(column) => set({ column })} />
            </Field>
          )}
          <Field label="Partition by (restart per group)">
            <ColChips value={n.config.partitionBy} cols={a} onChange={(partitionBy) => set({ partitionBy })} />
          </Field>
          <Field label="Order by">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <ColSelect value={n.config.orderBy} cols={a} onChange={(orderBy) => set({ orderBy })} />
              <select className="in" style={{ width: 96 }} value={n.config.desc ? 'desc' : 'asc'} onChange={(e) => set({ desc: e.target.value === 'desc' })}>
                <option value="desc">desc</option>
                <option value="asc">asc</option>
              </select>
            </div>
          </Field>
          <Field label="Output column">
            <input className="in mono" value={n.config.as} onChange={(e) => set({ as: e.target.value })} />
          </Field>
        </>
      );
    case 'union':
      return (
        <>
          <label className="row"><input type="checkbox" checked={n.config.distinct} onChange={(e) => set({ distinct: e.target.checked })} /> Remove duplicate rows (UNION instead of UNION ALL)</label>
          <p className="small muted">Columns are matched by name; a column missing from one input is filled with NULL. Connect any number of inputs.</p>
        </>
      );
    case 'sort':
      return (
        <>
          <Rows
            items={n.config.by}
            onChange={(by) => set({ by })}
            make={() => ({ column: '', desc: false })}
            addLabel="sort column"
            render={(x, upd) => (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <ColSelect value={x.column} cols={a} onChange={(column) => upd({ ...x, column })} />
                <select className="in" style={{ width: 96 }} value={x.desc ? 'desc' : 'asc'} onChange={(e) => upd({ ...x, desc: e.target.value === 'desc' })}>
                  <option value="asc">asc</option>
                  <option value="desc">desc</option>
                </select>
              </div>
            )}
          />
          <Field label="Keep only the first N rows (optional)">
            <input className="in" type="number" min={1} value={n.config.limit ?? ''} onChange={(e) => set({ limit: e.target.value ? Number(e.target.value) : null })} />
          </Field>
        </>
      );
    case 'quality':
      return (
        <>
          <Field label="When a row fails">
            <select className="in" value={n.config.action} onChange={(e) => set({ action: e.target.value as 'warn' | 'drop' })}>
              <option value="warn">warn, keep the row</option>
              <option value="drop">drop the row</option>
            </select>
          </Field>
          <Rows
            items={n.config.checks}
            onChange={(checks) => set({ checks })}
            make={() => ({ column: '', rule: 'not_null' as QRule, arg1: '', arg2: '' })}
            addLabel="check"
            render={(c, upd) => (
              <>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <ColSelect value={c.column} cols={a} onChange={(column) => upd({ ...c, column })} />
                  <select className="in" style={{ width: 130 }} value={c.rule} onChange={(e) => upd({ ...c, rule: e.target.value as QRule })}>
                    {RULES.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {c.rule === 'between' && (
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input className="in" placeholder="min" value={c.arg1} onChange={(e) => upd({ ...c, arg1: e.target.value })} />
                    <input className="in" placeholder="max" value={c.arg2} onChange={(e) => upd({ ...c, arg2: e.target.value })} />
                  </div>
                )}
                {(c.rule === 'accepted_values' || c.rule === 'matches') && <input className="in mono" placeholder={c.rule === 'matches' ? '^[A-Z]{2}\\d+$' : 'a, b, c'} value={c.arg1} onChange={(e) => upd({ ...c, arg1: e.target.value })} />}
              </>
            )}
          />
          {n.config.action === 'drop' && n.config.checks.some((c) => c.rule === 'unique') && <p className="small muted">Uniqueness is reported but never used to drop rows. Add a Deduplicate step for that.</p>}
        </>
      );
    case 'output':
      return (
        <>
          <Field label="Target table">
            <input className="in mono" value={n.config.table} onChange={(e) => set({ table: e.target.value })} />
          </Field>
          <Field label="Write mode">
            <select className="in" value={n.config.mode} onChange={(e) => set({ mode: e.target.value as 'overwrite' | 'append' })}>
              <option value="overwrite">overwrite (dbt: table)</option>
              <option value="append">append (dbt: incremental)</option>
            </select>
          </Field>
          <Field label="Format">
            <select className="in" value={n.config.format} onChange={(e) => set({ format: e.target.value as 'delta' | 'parquet' })}>
              <option value="delta">Delta</option>
              <option value="parquet">Parquet</option>
            </select>
          </Field>
        </>
      );
  }
}

export default function Inspector({ pipeline, node, states, issues, datasets, onUpdate, onDelete, onRename, onLayout }: { pipeline: Pipeline; node: PNode | null; states: Map<string, NodeState>; issues: Issue[]; datasets: Dataset[]; onUpdate: (n: PNode) => void; onDelete: (id: string) => void; onRename: (name: string) => void; onLayout: () => void }) {
  if (!node) {
    const errors = issues.filter((i) => i.severity === 'error').length;
    const outputs = pipeline.nodes.filter((n) => n.kind === 'output').length;
    return (
      <aside className="panel inspector" aria-label="Inspector">
        <div className="insp-anim" key="pipeline">
        <div className="insp-head" style={{ ['--cat' as string]: 'var(--accent)' }}>
          <span className="icon-tile"><Icon.sparkle size={18} /></span>
          <div className="grow">
            <div className="k">Pipeline</div>
            <div className="b">Overview and quick start</div>
          </div>
        </div>
        <div className="field">
          <label>Pipeline name</label>
          <input className="in" value={pipeline.name} onChange={(e) => onRename(e.target.value)} />
        </div>
        <div className="stats">
          <div className="stat"><div className="v">{pipeline.nodes.length}</div><div className="l">Steps</div></div>
          <div className="stat"><div className="v">{pipeline.edges.length}</div><div className="l">Connections</div></div>
          <div className="stat"><div className="v">{outputs}</div><div className="l">Outputs</div></div>
          <div className="stat"><div className="v" style={{ color: errors ? 'var(--bad)' : 'var(--good)' }}>{errors || '✓'}</div><div className="l">Problems</div></div>
        </div>
        <button className="btn soft xs" style={{ alignSelf: 'flex-start' }} onClick={onLayout} disabled={!pipeline.nodes.length}><Icon.tidy size={14} /> Tidy layout</button>
        <div>
          <div className="section-title">How to use</div>
          <ol className="tips">
            <li><span className="n">1</span><span><b>Drag steps</b> from the left onto the canvas, or click them.</span></li>
            <li><span className="n">2</span><span><b>Connect</b> the right dot of one step to the left dot of the next. Joins take a left (L) and a right (R) input.</span></li>
            <li><span className="n">3</span><span><b>Click a step</b> to configure it. Every change re-runs on DuckDB in your browser.</span></li>
            <li><span className="n">4</span><span>Select a step and press <b>Delete</b> to remove it.</span></li>
            <li><span className="n">5</span><span>The <b>Code</b> tab turns the graph into SQL, PySpark and a dbt project.</span></li>
          </ol>
        </div>
        </div>
      </aside>
    );
  }
  const st = states.get(node.id);
  const def = NODE_DEFS[node.kind];
  const ins = inputsOf(pipeline, node.id);
  const inCols = ins.map((i) => states.get(i.id)?.columns.map((c) => c.name) ?? []);
  const own = issues.filter((i) => i.nodeId === node.id);
  const set = (patch: object) => onUpdate({ ...node, config: { ...node.config, ...patch } } as PNode);
  return (
    <aside className="panel inspector" aria-label="Inspector">
      <div className={`insp-anim cat-${def.group.toLowerCase()}`} key={node.id}>
      <div className="insp-head">
        <span className="icon-tile"><KindIcon kind={node.kind} size={18} /></span>
        <div className="grow">
          <div className="k">{def.label}</div>
          <div className="b">{def.blurb}</div>
        </div>
        <button className="btn danger xs" onClick={() => onDelete(node.id)} title="Delete step"><Icon.trash size={14} /></button>
      </div>
      <div className="field">
        <label>Step name</label>
        <input className="in" value={node.label} onChange={(e) => onUpdate({ ...node, label: e.target.value })} />
      </div>
      {own.length > 0 ? (
        own.map((i, k) => <div key={k} className={`status ${i.severity === 'error' ? 'bad' : 'warn'}`}>{i.message}</div>)
      ) : st?.error ? (
        <div className={`status ${st.own ? 'bad' : 'warn'}`}>{st.error}</div>
      ) : st?.rows != null ? (
        <div className="status ok">
          {st.rows.toLocaleString('en-US')} rows · {st.columns.length} columns{st.ms != null ? ` · ${Math.round(st.ms)} ms` : ''}
        </div>
      ) : null}
      <ConfigForm n={node} inCols={inCols} datasets={datasets} set={set} />
      {node.kind === 'quality' && st?.quality && (
        <div>
          <div className="section-title">Results on {st.quality.total.toLocaleString('en-US')} input rows</div>
          <div className="list">
            {st.quality.checks.map((c) => (
              <div key={c.label} className="list">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono small">{c.label}</span>
                  <b style={{ color: c.failed ? 'var(--bad)' : 'var(--good)' }}>{c.failed ? `${c.failed.toLocaleString('en-US')} failed` : '✓ pass'}</b>
                </div>
                <div className="qbar"><div style={{ width: `${st.quality!.total ? Math.min(100, (c.failed / st.quality!.total) * 100 * 10) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {st?.columns.length ? (
        <div>
          <div className="section-title">Output schema</div>
          <div className="chips">
            {st.columns.map((c) => (
              <span key={c.name} className="chip static" title={c.type}>{c.name}<span className="muted"> {c.type.toLowerCase()}</span></span>
            ))}
          </div>
        </div>
      ) : null}
      </div>
    </aside>
  );
}

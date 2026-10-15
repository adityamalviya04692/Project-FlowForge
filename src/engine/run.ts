import { inputsOf, topoOrder, validate } from '../pipeline/graph';
import { nodeSelect, q, qualitySql } from '../pipeline/sql';
import type { Column, Pipeline, PNode } from '../pipeline/types';

/** The two operations the runner needs; implemented by DuckDB-WASM in the browser and native DuckDB in tests. */
export interface Exec {
  run(sql: string): Promise<void>;
  query(sql: string): Promise<Record<string, unknown>[]>;
}

export interface QualityResult {
  label: string;
  failed: number;
}

export interface NodeState {
  columns: Column[];
  rows?: number;
  ms?: number;
  error?: string;
  /** Problem with the node itself (vs. an upstream one). */
  own?: boolean;
  sql?: string;
  quality?: { total: number; checks: QualityResult[] };
}

export const viewName = (id: string) => `ff_${id}`;
export const sourceTable = (dataset: string) => `src_${dataset.replace(/\W+/g, '_')}`;

export function checkLabel(c: { column: string; rule: string; arg1: string; arg2: string }): string {
  const arg = c.rule === 'between' ? ` ${c.arg1 || '−∞'}…${c.arg2 || '∞'}` : c.rule === 'accepted_values' || c.rule === 'matches' ? ` ${c.arg1}` : '';
  return `${c.column} ${c.rule.replace('_', ' ')}${arg}`;
}

/**
 * Materialise every node as a view, in dependency order. A failing node does
 * not stop the run: its descendants are marked as blocked and everything else
 * still executes, so the user sees all problems at once.
 */
export async function materialize(p: Pipeline, ex: Exec, opts: { counts?: boolean } = {}): Promise<Map<string, NodeState>> {
  const out = new Map<string, NodeState>();
  const issues = validate(p);
  const { order, cyclic } = topoOrder(p);
  for (const n of cyclic) out.set(n.id, { columns: [], error: 'Part of a cycle', own: true });

  for (const n of order) {
    const own = issues.find((i) => i.nodeId === n.id && i.severity === 'error');
    const ins = inputsOf(p, n.id);
    const blocked = ins.find((i) => out.get(i.id)?.error);
    if (own) {
      out.set(n.id, { columns: [], error: own.message, own: true });
      continue;
    }
    if (blocked) {
      out.set(n.id, { columns: [], error: `Waiting on "${blocked.label}"`, own: false });
      continue;
    }
    const t0 = performance.now();
    const sql = nodeSelect(
      n,
      ins.map((i) => ({ ref: q(viewName(i.id), 'duckdb'), cols: out.get(i.id)!.columns.map((c) => c.name) })),
      'duckdb',
      n.kind === 'source' ? q(sourceTable(n.config.dataset), 'duckdb') : '',
    );
    try {
      await ex.run(`CREATE OR REPLACE VIEW ${q(viewName(n.id), 'duckdb')} AS ${sql}`);
      const desc = await ex.query(`DESCRIBE ${q(viewName(n.id), 'duckdb')}`);
      const state: NodeState = { columns: desc.map((r) => ({ name: String(r.column_name), type: String(r.column_type) })), sql };
      if (opts.counts !== false) {
        const [r] = await ex.query(`SELECT COUNT(*) AS n FROM ${q(viewName(n.id), 'duckdb')}`);
        state.rows = Number(r.n);
      }
      if (n.kind === 'quality') state.quality = await qualityOf(n, ins[0], ex);
      state.ms = performance.now() - t0;
      out.set(n.id, state);
    } catch (e) {
      out.set(n.id, { columns: [], error: cleanError(e), own: true, sql });
    }
  }
  return out;
}

async function qualityOf(n: Extract<PNode, { kind: 'quality' }>, input: PNode, ex: Exec): Promise<NodeState['quality']> {
  const checks = n.config.checks.filter((c) => c.column);
  if (!checks.length) return { total: 0, checks: [] };
  // Measured on the node's input, so "drop" mode still reports what it removed.
  const [r] = await ex.query(qualitySql({ ...n, config: { ...n.config, checks } }, q(viewName(input.id), 'duckdb'), 'duckdb'));
  return { total: Number(r.total), checks: checks.map((c, i) => ({ label: checkLabel(c), failed: Number(r[`c${i}`] ?? 0) })) };
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^(Binder|Parser|Catalog|Conversion|Invalid Input) Error: /, '').split('\n')[0].slice(0, 300);
}

export function columnNames(states: Map<string, NodeState>): Map<string, string[]> {
  return new Map([...states].map(([id, s]) => [id, s.columns.map((c) => c.name)]));
}

import type { Configs, NodeKind, PNode } from './types';

export interface NodeDef<K extends NodeKind = NodeKind> {
  kind: K;
  label: string;
  group: 'Input' | 'Transform' | 'Combine' | 'Quality' | 'Output';
  /** 0 = source, 1 = single input, 2 = left + right, 'many' = any number. */
  inputs: 0 | 1 | 2 | 'many';
  glyph: string;
  blurb: string;
  defaults: () => Configs[K];
}

export const NODE_DEFS: { [K in NodeKind]: NodeDef<K> } = {
  source: { kind: 'source', label: 'Source', group: 'Input', inputs: 0, glyph: '⛁', blurb: 'Read a dataset', defaults: () => ({ dataset: 'orders', table: 'raw.orders' }) },
  filter: { kind: 'filter', label: 'Filter', group: 'Transform', inputs: 1, glyph: '⏚', blurb: 'Keep rows that match conditions', defaults: () => ({ match: 'all', conditions: [{ column: '', op: '=', value: '' }] }) },
  select: { kind: 'select', label: 'Select / rename', group: 'Transform', inputs: 1, glyph: '☰', blurb: 'Choose, rename and cast columns', defaults: () => ({ columns: [] }) },
  derive: { kind: 'derive', label: 'Derive column', group: 'Transform', inputs: 1, glyph: 'ƒ', blurb: 'Add or replace columns with SQL expressions', defaults: () => ({ columns: [{ name: 'new_column', expr: '' }] }) },
  dedupe: { kind: 'dedupe', label: 'Deduplicate', group: 'Transform', inputs: 1, glyph: '⧉', blurb: 'Keep one row per key (latest wins)', defaults: () => ({ keys: [], orderBy: '', desc: true }) },
  window: { kind: 'window', label: 'Window', group: 'Transform', inputs: 1, glyph: '▤', blurb: 'Rank, running totals, lag / lead', defaults: () => ({ fn: 'row_number', column: '', partitionBy: [], orderBy: '', desc: true, as: 'rank' }) },
  sort: { kind: 'sort', label: 'Sort / limit', group: 'Transform', inputs: 1, glyph: '⇅', blurb: 'Order rows, optionally keep the top N', defaults: () => ({ by: [{ column: '', desc: true }], limit: null }) },
  join: { kind: 'join', label: 'Join', group: 'Combine', inputs: 2, glyph: '⋈', blurb: 'Combine two inputs on key columns', defaults: () => ({ how: 'left', keys: [{ left: '', right: '' }] }) },
  aggregate: { kind: 'aggregate', label: 'Aggregate', group: 'Combine', inputs: 1, glyph: 'Σ', blurb: 'Group by and summarise', defaults: () => ({ groupBy: [], aggs: [{ fn: 'count', column: '', as: 'rows' }] }) },
  union: { kind: 'union', label: 'Union', group: 'Combine', inputs: 'many', glyph: '∪', blurb: 'Stack inputs, matching columns by name', defaults: () => ({ distinct: false }) },
  quality: { kind: 'quality', label: 'Quality check', group: 'Quality', inputs: 1, glyph: '✓', blurb: 'Assert not null, unique, ranges and values', defaults: () => ({ action: 'warn', checks: [{ column: '', rule: 'not_null', arg1: '', arg2: '' }] }) },
  output: { kind: 'output', label: 'Output', group: 'Output', inputs: 1, glyph: '⬇', blurb: 'Write a table', defaults: () => ({ table: 'gold.result', mode: 'overwrite', format: 'delta' }) },
};

export const KIND_ORDER: NodeKind[] = ['source', 'filter', 'select', 'derive', 'dedupe', 'window', 'sort', 'join', 'aggregate', 'union', 'quality', 'output'];

let counter = 0;
export function newId(kind: NodeKind): string {
  counter = (counter + 1) % 1e6;
  return `${kind}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function makeNode(kind: NodeKind, position: { x: number; y: number }, label?: string): PNode {
  const def = NODE_DEFS[kind];
  return { id: newId(kind), kind, label: label ?? def.label, position, config: def.defaults() } as PNode;
}

/** A pipeline is a DAG of typed nodes; everything else (SQL, PySpark, dbt, the run) is derived from it. */

export type NodeKind = 'source' | 'filter' | 'select' | 'derive' | 'join' | 'aggregate' | 'dedupe' | 'window' | 'union' | 'sort' | 'quality' | 'output';

export type Op = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'starts_with' | 'in' | 'is_null' | 'not_null';
export type AggFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export type WinFn = 'row_number' | 'rank' | 'dense_rank' | 'running_sum' | 'lag' | 'lead';
export type QRule = 'not_null' | 'unique' | 'between' | 'accepted_values' | 'matches';

export interface Configs {
  source: { dataset: string; table: string };
  filter: { match: 'all' | 'any'; conditions: { column: string; op: Op; value: string }[] };
  select: { columns: { name: string; as: string; cast: string }[] };
  derive: { columns: { name: string; expr: string }[] };
  join: { how: 'inner' | 'left' | 'right' | 'full'; keys: { left: string; right: string }[] };
  aggregate: { groupBy: string[]; aggs: { fn: AggFn; column: string; as: string }[] };
  dedupe: { keys: string[]; orderBy: string; desc: boolean };
  window: { fn: WinFn; column: string; partitionBy: string[]; orderBy: string; desc: boolean; as: string };
  union: { distinct: boolean };
  sort: { by: { column: string; desc: boolean }[]; limit: number | null };
  quality: { action: 'warn' | 'drop'; checks: { column: string; rule: QRule; arg1: string; arg2: string }[] };
  output: { table: string; mode: 'overwrite' | 'append'; format: 'delta' | 'parquet' };
}

interface Base {
  id: string;
  label: string;
  position: { x: number; y: number };
}

export type PNode = { [K in NodeKind]: Base & { kind: K; config: Configs[K] } }[NodeKind];
export type NodeOf<K extends NodeKind> = Extract<PNode, { kind: K }>;

export interface PEdge {
  id: string;
  source: string;
  target: string;
  /** "left" / "right" for joins; otherwise "in". */
  targetHandle?: string;
}

export interface Pipeline {
  name: string;
  nodes: PNode[];
  edges: PEdge[];
}

export type Dialect = 'duckdb' | 'spark';

export interface Column {
  name: string;
  type: string;
}

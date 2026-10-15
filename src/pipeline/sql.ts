import { ancestors, inputsOf, stepNames, topoOrder } from './graph';
import type { Configs, Dialect, PNode, Pipeline } from './types';

export const q = (name: string, d: Dialect) => (d === 'spark' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`);

/** Numbers stay numbers; everything else becomes a quoted string. */
export function literal(v: string): string {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (/^(true|false|null)$/i.test(t)) return t.toUpperCase();
  return `'${t.replace(/'/g, "''")}'`;
}

export function condition(c: Configs['filter']['conditions'][number], d: Dialect): string {
  const col = q(c.column, d);
  switch (c.op) {
    case 'is_null':
      return `${col} IS NULL`;
    case 'not_null':
      return `${col} IS NOT NULL`;
    case 'contains':
      return `${col} LIKE ${literal(`%${c.value}%`)}`;
    case 'starts_with':
      return `${col} LIKE ${literal(`${c.value}%`)}`;
    case 'in':
      return `${col} IN (${c.value.split(',').map((v) => literal(v)).join(', ')})`;
    default:
      return `${col} ${c.op === '!=' ? '<>' : c.op} ${literal(c.value)}`;
  }
}

export function checkPasses(c: Configs['quality']['checks'][number], d: Dialect): string | null {
  const col = q(c.column, d);
  switch (c.rule) {
    case 'not_null':
      return `${col} IS NOT NULL`;
    case 'between': {
      const lo = c.arg1.trim();
      const hi = c.arg2.trim();
      if (lo && hi) return `${col} BETWEEN ${literal(lo)} AND ${literal(hi)}`;
      if (lo) return `${col} >= ${literal(lo)}`;
      if (hi) return `${col} <= ${literal(hi)}`;
      return null;
    }
    case 'accepted_values':
      return `${col} IN (${c.arg1.split(',').map((v) => literal(v)).join(', ')})`;
    case 'matches':
      return d === 'spark' ? `${col} RLIKE ${literal(c.arg1)}` : `regexp_matches(${col}, ${literal(c.arg1)})`;
    case 'unique':
      return null; // a property of the whole column, checked separately
  }
}

export const aggAlias = (a: Configs['aggregate']['aggs'][number]) => a.as || (a.fn === 'count' && !a.column ? 'rows' : `${a.fn}_${a.column}`);

function aggExpr(a: Configs['aggregate']['aggs'][number], d: Dialect): string {
  const col = a.column ? q(a.column, d) : '*';
  switch (a.fn) {
    case 'count':
      return `COUNT(${col})`;
    case 'count_distinct':
      return `COUNT(DISTINCT ${col})`;
    default:
      return `${a.fn.toUpperCase()}(${col})`;
  }
}

export function windowExpr(c: Configs['window'], d: Dialect): string {
  const over = [c.partitionBy.length ? `PARTITION BY ${c.partitionBy.map((x) => q(x, d)).join(', ')}` : '', c.orderBy ? `ORDER BY ${q(c.orderBy, d)}${c.desc ? ' DESC' : ''}` : ''].filter(Boolean).join(' ');
  switch (c.fn) {
    case 'running_sum':
      return `SUM(${q(c.column, d)}) OVER (${over} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`;
    case 'lag':
    case 'lead':
      return `${c.fn.toUpperCase()}(${q(c.column, d)}) OVER (${over})`;
    default:
      return `${c.fn.toUpperCase()}() OVER (${over})`;
  }
}

/** Output column names of a node, given its inputs' columns. */
export function outputColumns(n: PNode, inputs: string[][]): string[] {
  const [a = [], b = []] = inputs;
  switch (n.kind) {
    case 'source':
      return a;
    case 'select':
      return n.config.columns.map((c) => c.as || c.name);
    case 'derive': {
      const added = n.config.columns.map((c) => c.name).filter((x) => x && !a.includes(x));
      return [...a, ...added];
    }
    case 'join':
      return [...a, ...joinRight(n.config, a, b).map((r) => r.as)];
    case 'aggregate':
      return [...n.config.groupBy, ...n.config.aggs.map(aggAlias)];
    case 'window':
      return a.includes(n.config.as) ? a : [...a, n.config.as];
    case 'union':
      return [...new Set(inputs.flat())];
    default:
      return a; // filter, dedupe, sort, quality, output pass columns through
  }
}

/** Right-side columns of a join: drop keys that duplicate a same-named left key, suffix clashes with _right. */
export function joinRight(c: Configs['join'], left: string[], right: string[]): { name: string; as: string }[] {
  const sameKeys = new Set(c.keys.filter((k) => k.left === k.right).map((k) => k.right));
  return right.filter((r) => !sameKeys.has(r)).map((r) => ({ name: r, as: left.includes(r) ? `${r}_right` : r }));
}

export interface StepInput {
  ref: string;
  cols: string[];
}

/** One SELECT statement for a node, reading from its inputs' refs (views or CTE names). */
export function nodeSelect(n: PNode, ins: StepInput[], d: Dialect, sourceRef: string): string {
  const Q = (x: string) => q(x, d);
  const [a, b] = ins;
  const list = (cols: string[]) => cols.map(Q).join(', ');
  switch (n.kind) {
    case 'source':
      return `SELECT * FROM ${sourceRef}`;
    case 'filter': {
      const conds = n.config.conditions.filter((c) => c.column).map((c) => condition(c, d));
      return `SELECT * FROM ${a.ref}${conds.length ? ` WHERE ${conds.map((x) => (conds.length > 1 ? `(${x})` : x)).join(n.config.match === 'all' ? ' AND ' : ' OR ')}` : ''}`;
    }
    case 'select':
      return `SELECT ${n.config.columns.map((c) => `${c.cast ? `CAST(${Q(c.name)} AS ${c.cast})` : Q(c.name)}${(c.as && c.as !== c.name) || c.cast ? ` AS ${Q(c.as || c.name)}` : ''}`).join(', ')} FROM ${a.ref}`;
    case 'derive': {
      const byName = new Map(n.config.columns.filter((c) => c.name).map((c) => [c.name, c.expr]));
      const kept = a.cols.map((c) => (byName.has(c) ? `${byName.get(c)} AS ${Q(c)}` : Q(c)));
      const added = n.config.columns.filter((c) => c.name && !a.cols.includes(c.name)).map((c) => `${c.expr} AS ${Q(c.name)}`);
      return `SELECT ${[...kept, ...added].join(', ')} FROM ${a.ref}`;
    }
    case 'join': {
      const right = joinRight(n.config, a.cols, b.cols);
      const cols = [...a.cols.map((c) => `l.${Q(c)}`), ...right.map((r) => `r.${Q(r.name)}${r.as !== r.name ? ` AS ${Q(r.as)}` : ''}`)];
      const on = n.config.keys.map((k) => `l.${Q(k.left)} = r.${Q(k.right)}`).join(' AND ');
      return `SELECT ${cols.join(', ')} FROM ${a.ref} AS l ${n.config.how.toUpperCase()} JOIN ${b.ref} AS r ON ${on}`;
    }
    case 'aggregate': {
      const g = n.config.groupBy;
      const sel = [...g.map(Q), ...n.config.aggs.map((x) => `${aggExpr(x, d)} AS ${Q(aggAlias(x))}`)];
      return `SELECT ${sel.join(', ')} FROM ${a.ref}${g.length ? ` GROUP BY ${list(g)}` : ''}`;
    }
    case 'dedupe': {
      const order = n.config.orderBy ? `ORDER BY ${Q(n.config.orderBy)}${n.config.desc ? ' DESC' : ''}` : `ORDER BY ${list(n.config.keys)}`;
      return `SELECT ${list(a.cols)} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY ${list(n.config.keys)} ${order}) AS __rn FROM ${a.ref}) AS t WHERE __rn = 1`;
    }
    case 'window': {
      const others = a.cols.filter((c) => c !== n.config.as);
      return `SELECT ${[...others.map(Q), `${windowExpr(n.config, d)} AS ${Q(n.config.as)}`].join(', ')} FROM ${a.ref}`;
    }
    case 'union': {
      const all = [...new Set(ins.flatMap((i) => i.cols))];
      const parts = ins.map((i) => `SELECT ${all.map((c) => (i.cols.includes(c) ? Q(c) : `NULL AS ${Q(c)}`)).join(', ')} FROM ${i.ref}`);
      return parts.join(n.config.distinct ? '\nUNION\n' : '\nUNION ALL\n');
    }
    case 'sort': {
      const by = n.config.by.filter((x) => x.column).map((x) => `${Q(x.column)}${x.desc ? ' DESC' : ''}`);
      return `SELECT * FROM ${a.ref}${by.length ? ` ORDER BY ${by.join(', ')}` : ''}${n.config.limit ? ` LIMIT ${Math.max(0, Math.floor(n.config.limit))}` : ''}`;
    }
    case 'quality': {
      if (n.config.action !== 'drop') return `SELECT * FROM ${a.ref}`;
      const pass = n.config.checks.filter((c) => c.column).map((c) => checkPasses(c, d)).filter((x): x is string => !!x);
      return `SELECT * FROM ${a.ref}${pass.length ? ` WHERE ${pass.map((x) => `(${x})`).join(' AND ')}` : ''}`;
    }
    case 'output':
      return `SELECT * FROM ${a.ref}`;
  }
}

/** Failing-row count per quality check, as one aggregate query. */
export function qualitySql(n: Extract<PNode, { kind: 'quality' }>, ref: string, d: Dialect): string {
  const parts = n.config.checks.map((c, i) => {
    if (!c.column) return `0 AS c${i}`;
    if (c.rule === 'unique') return `COUNT(${q(c.column, d)}) - COUNT(DISTINCT ${q(c.column, d)}) AS c${i}`;
    const pass = checkPasses(c, d);
    return pass ? `SUM(CASE WHEN ${pass} THEN 0 ELSE 1 END) AS c${i}` : `0 AS c${i}`;
  });
  return `SELECT COUNT(*) AS total, ${parts.join(', ')} FROM ${ref}`;
}

/**
 * A readable SQL script: one statement per Output node, each a CTE chain over
 * the steps it depends on. `columns` holds the inferred columns of every node.
 */
export function compileScript(p: Pipeline, columns: Map<string, string[]>, d: Dialect): string {
  const names = stepNames(p);
  const { order } = topoOrder(p);
  const outputs = order.filter((n) => n.kind === 'output');
  const sourceRef = (n: PNode) => (n.kind === 'source' ? n.config.table.split('.').map((x) => q(x, d)).join('.') : '');
  const header = d === 'spark' ? '-- Spark SQL / Databricks' : '-- DuckDB';
  if (outputs.length === 0) return `${header}\n-- Add an Output node to generate SQL.`;
  const blocks = outputs.map((o) => {
    if (o.kind !== 'output') return '';
    const deps = ancestors(p, o.id);
    const steps = order.filter((n) => deps.has(n.id));
    const ctes = steps.map((n) => {
      const ins = inputsOf(p, n.id).map((i) => ({ ref: names.get(i.id)!, cols: columns.get(i.id) ?? [] }));
      return `${names.get(n.id)} AS (\n  ${nodeSelect(n, ins, d, sourceRef(n)).replace(/\n/g, '\n  ')}\n)`;
    });
    const last = names.get(inputsOf(p, o.id)[0]?.id ?? '') ?? 'missing_input';
    const target = o.config.table.split('.').map((x) => q(x, d)).join('.');
    const verb = o.config.mode === 'append' ? `INSERT INTO ${target}` : d === 'spark' ? `CREATE OR REPLACE TABLE ${target}${o.config.format === 'delta' ? ' USING DELTA' : ' USING PARQUET'} AS` : `CREATE OR REPLACE TABLE ${target} AS`;
    return `-- ${o.label}\n${verb}\nWITH ${ctes.join(',\n')}\nSELECT * FROM ${last};`;
  });
  const schemas = [...new Set(outputs.map((o) => (o.kind === 'output' && o.config.table.includes('.') ? o.config.table.split('.')[0] : '')).filter(Boolean))];
  const prelude = schemas.map((s) => `CREATE SCHEMA IF NOT EXISTS ${q(s, d)};`).join('\n');
  return `${header}\n${prelude}\n\n${blocks.join('\n\n')}\n`;
}

import { inputsOf, stepNames, topoOrder } from './graph';
import { aggAlias, joinRight } from './sql';
import type { Configs, PNode, Pipeline } from './types';

const py = (s: string) => JSON.stringify(s); // a valid Python string literal for plain text
const col = (c: string) => `F.col(${py(c)})`;

function lit(v: string): string {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (/^(true|false)$/i.test(t)) return t[0].toUpperCase() + t.slice(1).toLowerCase();
  return py(t);
}

function cond(c: Configs['filter']['conditions'][number]): string {
  const x = col(c.column);
  switch (c.op) {
    case 'is_null':
      return `${x}.isNull()`;
    case 'not_null':
      return `${x}.isNotNull()`;
    case 'contains':
      return `${x}.contains(${py(c.value)})`;
    case 'starts_with':
      return `${x}.startswith(${py(c.value)})`;
    case 'in':
      return `${x}.isin(${c.value.split(',').map(lit).join(', ')})`;
    case '=':
      return `(${x} == ${lit(c.value)})`;
    default:
      return `(${x} ${c.op} ${lit(c.value)})`;
  }
}

function check(c: Configs['quality']['checks'][number]): string | null {
  const x = col(c.column);
  switch (c.rule) {
    case 'not_null':
      return `${x}.isNotNull()`;
    case 'between':
      if (c.arg1.trim() && c.arg2.trim()) return `${x}.between(${lit(c.arg1)}, ${lit(c.arg2)})`;
      if (c.arg1.trim()) return `(${x} >= ${lit(c.arg1)})`;
      if (c.arg2.trim()) return `(${x} <= ${lit(c.arg2)})`;
      return null;
    case 'accepted_values':
      return `${x}.isin(${c.arg1.split(',').map(lit).join(', ')})`;
    case 'matches':
      return `${x}.rlike(${py(c.arg1)})`;
    case 'unique':
      return null;
  }
}

function aggCall(a: Configs['aggregate']['aggs'][number]): string {
  const name = aggAlias(a);
  if (a.fn === 'count') return `F.count(${a.column ? py(a.column) : '"*"'}).alias(${py(name)})`;
  if (a.fn === 'count_distinct') return `F.countDistinct(${py(a.column)}).alias(${py(name)})`;
  return `F.${a.fn}(${py(a.column)}).alias(${py(name)})`;
}

function windowSpec(partitionBy: string[], orderBy: string, desc: boolean): string {
  const parts = ['Window'];
  parts.push(partitionBy.length ? `partitionBy(${partitionBy.map(py).join(', ')})` : 'partitionBy()');
  if (orderBy) parts.push(`orderBy(${col(orderBy)}${desc ? '.desc()' : ''})`);
  return parts.join('.');
}

function step(n: PNode, v: string, ins: { v: string; cols: string[] }[]): string[] {
  const [a, b] = ins;
  switch (n.kind) {
    case 'source':
      return [`${v} = spark.read.table(${py(n.config.table)})`];
    case 'filter': {
      const cs = n.config.conditions.filter((c) => c.column).map(cond);
      return [`${v} = ${a.v}${cs.length ? `.filter(${cs.join(n.config.match === 'all' ? ' & ' : ' | ')})` : ''}`];
    }
    case 'select':
      return [`${v} = ${a.v}.select(`, ...n.config.columns.map((c) => `    ${col(c.name)}${c.cast ? `.cast(${py(c.cast.toLowerCase())})` : ''}${(c.as && c.as !== c.name) || c.cast ? `.alias(${py(c.as || c.name)})` : ''},`), ')'];
    case 'derive':
      return [`${v} = (`, `    ${a.v}`, ...n.config.columns.filter((c) => c.name).map((c) => `    .withColumn(${py(c.name)}, F.expr(${py(c.expr)}))`), ')'];
    case 'join': {
      const right = joinRight(n.config, a.cols, b.cols);
      const on = n.config.keys.map((k) => `(F.col(${py(`l.${k.left}`)}) == F.col(${py(`r.${k.right}`)}))`).join(' & ');
      return [
        `${v} = (`,
        `    ${a.v}.alias("l")`,
        `    .join(${b.v}.alias("r"), ${on}, ${py(n.config.how === 'full' ? 'full_outer' : n.config.how)})`,
        `    .select(`,
        ...a.cols.map((c) => `        F.col(${py(`l.${c}`)}).alias(${py(c)}),`),
        ...right.map((r) => `        F.col(${py(`r.${r.name}`)}).alias(${py(r.as)}),`),
        '    )',
        ')',
      ];
    }
    case 'aggregate':
      return [`${v} = ${a.v}.groupBy(${n.config.groupBy.map(py).join(', ')}).agg(`, ...n.config.aggs.map((x) => `    ${aggCall(x)},`), ')'];
    case 'dedupe': {
      const w = windowSpec(n.config.keys, n.config.orderBy || n.config.keys[0], n.config.desc);
      return [`${v} = (`, `    ${a.v}.withColumn("__rn", F.row_number().over(${w}))`, '    .filter(F.col("__rn") == 1)', '    .drop("__rn")', ')'];
    }
    case 'window': {
      const c = n.config;
      const w = windowSpec(c.partitionBy, c.orderBy, c.desc);
      const expr =
        c.fn === 'running_sum'
          ? `F.sum(${py(c.column)}).over(${w}.rowsBetween(Window.unboundedPreceding, Window.currentRow))`
          : c.fn === 'lag' || c.fn === 'lead'
            ? `F.${c.fn}(${py(c.column)}).over(${w})`
            : `F.${c.fn}().over(${w})`;
      return [`${v} = ${a.v}.withColumn(${py(c.as)}, ${expr})`];
    }
    case 'union': {
      const [first, ...rest] = ins;
      return [`${v} = ${first.v}${rest.map((r) => `.unionByName(${r.v}, allowMissingColumns=True)`).join('')}${n.config.distinct ? '.distinct()' : ''}`];
    }
    case 'sort': {
      const by = n.config.by.filter((x) => x.column).map((x) => `${col(x.column)}${x.desc ? '.desc()' : '.asc()'}`);
      return [`${v} = ${a.v}${by.length ? `.orderBy(${by.join(', ')})` : ''}${n.config.limit ? `.limit(${Math.floor(n.config.limit)})` : ''}`];
    }
    case 'quality': {
      const lines = [`# Data quality: ${n.label}`];
      n.config.checks.filter((c) => c.column).forEach((c) => {
        const desc = `${c.rule} on ${c.column}${c.arg1 ? ` (${c.arg1}${c.arg2 ? `..${c.arg2}` : ''})` : ''}`;
        if (c.rule === 'unique') {
          lines.push(`_dupes = ${a.v}.groupBy(${py(c.column)}).count().filter("count > 1").count()`, `if _dupes:`, `    print(f"[quality] ${desc}: {_dupes} duplicated values")`);
        } else {
          const pass = check(c);
          if (pass) lines.push(`_failed = ${a.v}.filter(~(${pass})).count()`, `if _failed:`, `    print(f"[quality] ${desc}: {_failed} failing rows")`);
        }
      });
      const passes = n.config.checks.filter((c) => c.column).map(check).filter((x): x is string => !!x);
      lines.push(n.config.action === 'drop' && passes.length ? `${v} = ${a.v}.filter(${passes.join(' & ')})` : `${v} = ${a.v}`);
      return lines;
    }
    case 'output':
      return [`${v} = ${a.v}`, `${v}.write.format(${py(n.config.format)}).mode(${py(n.config.mode)}).saveAsTable(${py(n.config.table)})`];
  }
}

/** A runnable PySpark script equivalent to the pipeline. */
export function toPySpark(p: Pipeline, columns: Map<string, string[]>): string {
  const names = stepNames(p);
  const v = (id: string) => `df_${names.get(id)}`;
  const lines = [
    `"""${p.name}: generated by FlowForge."""`,
    'from pyspark.sql import SparkSession, Window',
    'from pyspark.sql import functions as F',
    '',
    `spark = SparkSession.builder.appName(${py(p.name)}).getOrCreate()`,
    '',
  ];
  for (const n of topoOrder(p).order) {
    const ins = inputsOf(p, n.id).map((i) => ({ v: v(i.id), cols: columns.get(i.id) ?? [] }));
    if ((n.kind === 'join' && ins.length < 2) || (n.kind !== 'source' && ins.length === 0)) {
      lines.push(`# ${n.label}: not connected yet`, '');
      continue;
    }
    lines.push(`# ${n.label}`, ...step(n, v(n.id), ins), '');
  }
  return lines.join('\n');
}

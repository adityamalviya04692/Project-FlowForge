// Runs pipelines for real on native DuckDB and checks the generated SQL, PySpark and dbt.
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { columnNames, materialize, sourceTable, type Exec } from '../src/engine/run';
import { connect, stepNames, topoOrder, validate, wouldCreateCycle } from '../src/pipeline/graph';
import { toDbt } from '../src/pipeline/dbt';
import { toPySpark } from '../src/pipeline/pyspark';
import { compileScript, condition, literal, nodeSelect } from '../src/pipeline/sql';
import { demoPipeline } from '../src/pipeline/templates';
import type { Pipeline, PNode } from '../src/pipeline/types';
import { makeNode } from '../src/pipeline/catalog';

const SAMPLE = new URL('../public/sample/', import.meta.url).pathname;
let con: DuckDBConnection;

const exec: Exec = {
  run: async (sql) => {
    await con.run(sql);
  },
  query: async (sql) => (await con.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[],
};

beforeAll(async () => {
  con = await (await DuckDBInstance.create(':memory:')).connect();
  for (const d of ['orders', 'customers', 'products']) await con.run(`CREATE TABLE ${sourceTable(d)} AS SELECT * FROM read_csv_auto('${SAMPLE}${d}.csv')`);
});

const one = async (sql: string) => (await exec.query(sql))[0];

describe('demo pipeline on DuckDB', () => {
  const p = demoPipeline();
  let states: Awaited<ReturnType<typeof materialize>>;
  beforeAll(async () => {
    states = await materialize(p, exec);
  });

  it('validates and runs every node without errors', () => {
    expect(validate(p).filter((i) => i.severity === 'error')).toEqual([]);
    expect([...states].filter(([, s]) => s.error)).toEqual([]);
  });

  it('dedupes late updates, filters bad rows and gates on quality', async () => {
    expect(states.get('orders')!.rows).toBe(3200);
    expect(states.get('latest')!.rows).toBe(3000);
    const valid = states.get('valid')!.rows!;
    expect(valid).toBeLessThan(3000);
    const gate = states.get('gate')!;
    const nullCustomers = gate.quality!.checks.find((c) => c.label.startsWith('customer_id'))!.failed;
    expect(nullCustomers).toBeGreaterThan(0);
    expect(gate.rows).toBe(states.get('revenue')!.rows! - nullCustomers);
    expect(gate.quality!.checks.find((c) => c.label.startsWith('order_id'))!.failed).toBe(0); // unique after dedupe
  });

  it('joins keep same-named keys once and enrich every column', () => {
    const cols = states.get('with_product')!.columns.map((c) => c.name);
    expect(cols).toEqual(['order_id', 'customer_id', 'product_id', 'quantity', 'unit_price', 'status', 'channel', 'order_date', 'updated_at', 'name', 'city', 'segment', 'signup_date', 'product_name', 'category', 'price']);
  });

  it('builds both marts with correct totals', async () => {
    const totalRevenue = Number((await one('SELECT SUM(revenue) AS r FROM ff_gate')).r);
    const martRevenue = Number((await one('SELECT SUM(revenue) AS r FROM ff_out_daily')).r);
    expect(martRevenue).toBeCloseTo(totalRevenue, 2);
    const top = await exec.query('SELECT segment, MAX(segment_rank) AS worst, COUNT(*) AS n FROM ff_out_top GROUP BY segment ORDER BY segment');
    expect(top.map((r) => r.segment)).toEqual(['business', 'consumer', 'vip']);
    for (const r of top) expect(Number(r.worst)).toBeLessThanOrEqual(10);
  });

  it('compiles a standalone SQL script that DuckDB executes end to end', async () => {
    const script = compileScript(p, columnNames(states), 'duckdb');
    // Point the raw.* sources at the loaded sample tables.
    await con.run('CREATE SCHEMA IF NOT EXISTS raw');
    for (const d of ['orders', 'customers', 'products']) await con.run(`CREATE OR REPLACE VIEW raw.${d} AS SELECT * FROM ${sourceTable(d)}`);
    await con.run(script.replace(/^--.*$/gm, ''));
    const a = await one('SELECT COUNT(*) AS n, SUM(revenue) AS r FROM gold.daily_revenue');
    const b = await one('SELECT COUNT(*) AS n, SUM(revenue) AS r FROM ff_out_daily');
    expect(a).toEqual(b);
  });

  it('generates syntactically valid PySpark', () => {
    const code = toPySpark(p, columnNames(states));
    expect(code).toContain('spark.read.table("raw.orders")');
    expect(code).toContain('.saveAsTable("gold.top_customers")');
    const file = join(mkdtempSync(join(tmpdir(), 'ff-')), 'job.py');
    writeFileSync(file, code);
    execFileSync('python3', ['-c', `import ast,sys; ast.parse(open(sys.argv[1]).read())`, file]);
  });

  it('generates a dbt project with sources, models and tests', () => {
    const files = toDbt(p, columnNames(states));
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['dbt_project.yml', 'models/sources.yml', 'models/marts/daily_revenue.sql', 'models/marts/top_customers.sql', 'models/marts/schema.yml', 'packages.yml']));
    const model = files.find((f) => f.path === 'models/marts/daily_revenue.sql')!.content;
    expect(model).toContain("{{ source('raw', 'orders') }}");
    expect(model).toContain('`revenue`');
    const schema = files.find((f) => f.path === 'models/marts/schema.yml')!.content;
    expect(schema).toContain('dbt_utils.accepted_range');
  });

  it('names steps readably and uniquely', () => {
    const names = [...stepNames(p).values()];
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('latest_order_version');
  });
});

describe('graph editing rules', () => {
  const base = demoPipeline();

  it('rejects cycles and connections out of an output', () => {
    expect(wouldCreateCycle(base, 'out_daily', 'orders')).toBe(true);
    expect(connect(base, 'gate', 'orders')).toBeNull();
    expect(connect(base, 'out_daily', 'daily')).toBeNull();
  });

  it('replaces the occupant of a single-input slot', () => {
    const next = connect(base, 'orders', 'valid')!;
    expect(next.edges.filter((e) => e.target === 'valid').map((e) => e.source)).toEqual(['orders']);
  });

  it('reports missing inputs and config as validation errors', () => {
    const lonely = makeNode('join', { x: 0, y: 0 });
    const p: Pipeline = { name: 'x', nodes: [lonely], edges: [] };
    const msgs = validate(p).map((i) => i.message);
    expect(msgs).toContain('Connect both the left and the right input');
    expect(msgs).toContain('Choose the join keys');
  });
});

describe('every node kind', () => {
  async function runSingle(node: PNode, inputs: string[] = ['orders']) {
    const sources = inputs.map((d) => ({ id: `src_${d}`, kind: 'source', label: d, position: { x: 0, y: 0 }, config: { dataset: d, table: `raw.${d}` } }) as PNode);
    const p: Pipeline = {
      name: 't',
      nodes: [...sources, node],
      edges: sources.map((s, i) => ({ id: `e${i}`, source: s.id, target: node.id, targetHandle: node.kind === 'join' ? (i === 0 ? 'left' : 'right') : 'in' })),
    };
    const s = await materialize(p, exec);
    expect(s.get(node.id)!.error).toBeUndefined();
    return { state: s.get(node.id)!, rows: await exec.query(`SELECT * FROM ff_${node.id} LIMIT 5`) };
  }

  it('select renames and casts', async () => {
    const { state } = await runSingle({ id: 'sel', kind: 'select', label: 's', position: { x: 0, y: 0 }, config: { columns: [{ name: 'order_id', as: 'id', cast: '' }, { name: 'quantity', as: 'qty', cast: 'DOUBLE' }] } });
    expect(state.columns).toEqual([{ name: 'id', type: 'VARCHAR' }, { name: 'qty', type: 'DOUBLE' }]);
  });

  it('derive replaces an existing column in place', async () => {
    const { state, rows } = await runSingle({ id: 'der', kind: 'derive', label: 'd', position: { x: 0, y: 0 }, config: { columns: [{ name: 'status', expr: 'UPPER(status)' }] } });
    expect(state.columns.map((c) => c.name).indexOf('status')).toBe(5);
    expect(String(rows[0].status)).toMatch(/^[A-Z]+$/);
  });

  it('window running sum, union with mismatched columns, sort with limit', async () => {
    const w = await runSingle({ id: 'win', kind: 'window', label: 'w', position: { x: 0, y: 0 }, config: { fn: 'running_sum', column: 'quantity', partitionBy: ['customer_id'], orderBy: 'order_date', desc: false, as: 'cum_qty' } });
    expect(w.state.columns.at(-1)!.name).toBe('cum_qty');
    const u = await runSingle({ id: 'uni', kind: 'union', label: 'u', position: { x: 0, y: 0 }, config: { distinct: false } }, ['orders', 'products']);
    expect(u.state.rows).toBe(3200 + 72);
    const s = await runSingle({ id: 'srt', kind: 'sort', label: 's', position: { x: 0, y: 0 }, config: { by: [{ column: 'unit_price', desc: true }], limit: 3 } });
    expect(s.state.rows).toBe(3);
  });

  it('reports SQL errors on the node that caused them, and blocks its descendants', async () => {
    const p = demoPipeline();
    const broken = { ...p, nodes: p.nodes.map((n) => (n.id === 'revenue' && n.kind === 'derive' ? { ...n, config: { columns: [{ name: 'revenue', expr: 'quantity * no_such_column' }] } } : n)) };
    const s = await materialize(broken, exec, { counts: false });
    expect(s.get('revenue')).toMatchObject({ own: true });
    expect(s.get('revenue')!.error).toMatch(/no_such_column/);
    expect(s.get('gate')).toMatchObject({ own: false, error: 'Waiting on "Revenue"' });
    expect(s.get('with_product')!.error).toBeUndefined();
  });

  it('builds portable filter conditions and literals', () => {
    expect(literal('42')).toBe('42');
    expect(literal("O'Brien")).toBe("'O''Brien'");
    expect(condition({ column: 'status', op: 'in', value: 'a, b' }, 'spark')).toBe("`status` IN ('a', 'b')");
    expect(condition({ column: 'x', op: 'not_null', value: '' }, 'duckdb')).toBe('"x" IS NOT NULL');
    const order = topoOrder(demoPipeline()).order.map((n) => n.id);
    expect(order.indexOf('orders')).toBeLessThan(order.indexOf('latest'));
    expect(nodeSelect({ id: 'f', kind: 'filter', label: 'f', position: { x: 0, y: 0 }, config: { match: 'any', conditions: [{ column: 'a', op: '>', value: '1' }, { column: 'b', op: '=', value: 'x' }] } }, [{ ref: 't', cols: [] }], 'duckdb', '')).toBe(`SELECT * FROM t WHERE ("a" > 1) OR ("b" = 'x')`);
  });
});

describe('samples on disk', () => {
  it('are the files the app fetches', () => {
    expect(readFileSync(`${SAMPLE}orders.csv`, 'utf8').split('\n')[0]).toBe('order_id,customer_id,product_id,quantity,unit_price,status,channel,order_date,updated_at');
  });
});

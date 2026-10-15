import * as duckdb from '@duckdb/duckdb-wasm';
import { DataType, type Field, type Table } from 'apache-arrow';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { q } from '../pipeline/sql';
import type { Exec } from './run';
import { sourceTable, viewName } from './run';

// Self-hosted bundles: data and queries never leave the page.
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

let dbP: Promise<duckdb.AsyncDuckDB> | null = null;
let connP: Promise<duckdb.AsyncDuckDBConnection> | null = null;

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  dbP ??= (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(bundle.mainWorker!));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  })();
  return dbP;
}

const conn = () => (connP ??= getDb().then((db) => db.connect()));

export type Row = Record<string, unknown>;

export function cell(value: unknown, field?: Field): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (field && (DataType.isTimestamp(field.type) || DataType.isDate(field.type))) {
    const iso = new Date(Number(value)).toISOString();
    return DataType.isDate(field.type) ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (field && DataType.isDecimal(field.type)) return Number(String(value)) / 10 ** (field.type as { scale: number }).scale;
  if (ArrayBuffer.isView(value)) return `<${value.byteLength} bytes>`;
  if (typeof value === 'object') return JSON.stringify((value as { toJSON?: () => unknown }).toJSON?.() ?? value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return value;
}

function rows(t: Table): Row[] {
  const fields = t.schema.fields;
  const out: Row[] = [];
  for (let i = 0; i < t.numRows; i++) {
    const r = t.get(i) as unknown as Row;
    const o: Row = {};
    for (const f of fields) o[f.name] = cell(r[f.name], f);
    out.push(o);
  }
  return out;
}

export const wasmExec: Exec = {
  async run(sql) {
    await (await conn()).query(sql);
  },
  async query(sql) {
    return rows(await (await conn()).query(sql));
  },
};

export type FileFormat = 'csv' | 'parquet' | 'json';
export const formatOf = (name: string): FileFormat | null => (/\.(csv|tsv|txt)$/i.test(name) ? 'csv' : /\.(parquet|pq)$/i.test(name) ? 'parquet' : /\.(json|jsonl|ndjson)$/i.test(name) ? 'json' : null);

/** Load file bytes as a source table src_<dataset>. */
export async function registerDataset(dataset: string, fileName: string, bytes: Uint8Array): Promise<void> {
  const fmt = formatOf(fileName);
  if (!fmt) throw new Error(`${fileName}: use CSV, Parquet or JSON`);
  const db = await getDb();
  const path = `in_${Date.now()}_${fileName.replace(/[^\w.]/g, '_')}`;
  await db.registerFileBuffer(path, bytes);
  if (fmt === 'json') await wasmExec.run('INSTALL json; LOAD json;');
  const reader = fmt === 'csv' ? `read_csv_auto('${path}', sample_size = -1)` : fmt === 'parquet' ? `read_parquet('${path}')` : `read_json_auto('${path}')`;
  await wasmExec.run(`CREATE OR REPLACE TABLE ${q(sourceTable(dataset), 'duckdb')} AS SELECT * FROM ${reader}`);
}

export async function preview(nodeId: string, limit = 200): Promise<{ columns: string[]; rows: Row[] }> {
  const t = await (await conn()).query(`SELECT * FROM ${q(viewName(nodeId), 'duckdb')} LIMIT ${limit}`);
  return { columns: t.schema.fields.map((f) => f.name), rows: rows(t) };
}

export async function exportNode(nodeId: string, format: 'csv' | 'parquet'): Promise<Uint8Array> {
  const db = await getDb();
  const out = `out_${Date.now()}.${format}`;
  await wasmExec.run(`COPY (SELECT * FROM ${q(viewName(nodeId), 'duckdb')}) TO '${out}' (${format === 'csv' ? 'FORMAT CSV, HEADER' : 'FORMAT PARQUET, COMPRESSION ZSTD'})`);
  const buf = await db.copyFileToBuffer(out);
  await db.dropFile(out);
  return buf;
}

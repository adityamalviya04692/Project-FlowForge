import { Graph, layout } from '@dagrejs/dagre';
import type { PEdge, Pipeline, PNode } from './types';

export const SAMPLE_DATASETS = [
  { name: 'orders', file: 'orders.csv', table: 'raw.orders', blurb: '3,200 orders with late updates, cancellations and a few bad rows' },
  { name: 'customers', file: 'customers.csv', table: 'raw.customers', blurb: '600 customers with city and segment' },
  { name: 'products', file: 'products.csv', table: 'raw.products', blurb: '72 products in 6 categories' },
];

const NODE_W = 210;
const NODE_H = 76;

/** Left-to-right layered layout of the whole pipeline. */
export function autoLayout(p: Pipeline): Pipeline {
  const g = new Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 34, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of p.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of p.edges) g.setEdge(e.source, e.target);
  layout(g);
  return { ...p, nodes: p.nodes.map((n) => ({ ...n, position: { x: (g.node(n.id) as { x: number }).x - NODE_W / 2, y: (g.node(n.id) as { y: number }).y - NODE_H / 2 } })) };
}

const at = { x: 0, y: 0 };
const e = (source: string, target: string, targetHandle = 'in'): PEdge => ({ id: `e_${source}_${target}_${targetHandle}`, source, target, targetHandle });

/** The demo: clean orders, enrich them, gate on quality, then build two marts. */
export function demoPipeline(): Pipeline {
  const nodes: PNode[] = [
    { id: 'orders', kind: 'source', label: 'Orders', position: at, config: { dataset: 'orders', table: 'raw.orders' } },
    { id: 'customers', kind: 'source', label: 'Customers', position: at, config: { dataset: 'customers', table: 'raw.customers' } },
    { id: 'products', kind: 'source', label: 'Products', position: at, config: { dataset: 'products', table: 'raw.products' } },
    { id: 'latest', kind: 'dedupe', label: 'Latest order version', position: at, config: { keys: ['order_id'], orderBy: 'updated_at', desc: true } },
    {
      id: 'valid',
      kind: 'filter',
      label: 'Valid orders',
      position: at,
      config: { match: 'all', conditions: [{ column: 'status', op: '!=', value: 'cancelled' }, { column: 'quantity', op: '>', value: '0' }] },
    },
    { id: 'with_customer', kind: 'join', label: 'Add customer', position: at, config: { how: 'left', keys: [{ left: 'customer_id', right: 'customer_id' }] } },
    { id: 'with_product', kind: 'join', label: 'Add product', position: at, config: { how: 'left', keys: [{ left: 'product_id', right: 'product_id' }] } },
    {
      id: 'revenue',
      kind: 'derive',
      label: 'Revenue',
      position: at,
      config: {
        columns: [
          { name: 'revenue', expr: 'quantity * unit_price' },
          { name: 'order_size', expr: "CASE WHEN quantity * unit_price >= 5000 THEN 'large' ELSE 'standard' END" },
        ],
      },
    },
    {
      id: 'gate',
      kind: 'quality',
      label: 'Quality gate',
      position: at,
      config: {
        action: 'drop',
        checks: [
          { column: 'customer_id', rule: 'not_null', arg1: '', arg2: '' },
          { column: 'revenue', rule: 'between', arg1: '0', arg2: '100000' },
          { column: 'status', rule: 'accepted_values', arg1: 'completed,returned,pending', arg2: '' },
          { column: 'order_id', rule: 'unique', arg1: '', arg2: '' },
        ],
      },
    },
    {
      id: 'daily',
      kind: 'aggregate',
      label: 'Daily revenue',
      position: at,
      config: {
        groupBy: ['order_date', 'category'],
        aggs: [
          { fn: 'sum', column: 'revenue', as: 'revenue' },
          { fn: 'count_distinct', column: 'order_id', as: 'orders' },
          { fn: 'sum', column: 'quantity', as: 'units' },
        ],
      },
    },
    { id: 'daily_sorted', kind: 'sort', label: 'Newest first', position: at, config: { by: [{ column: 'order_date', desc: true }, { column: 'revenue', desc: true }], limit: null } },
    { id: 'out_daily', kind: 'output', label: 'gold.daily_revenue', position: at, config: { table: 'gold.daily_revenue', mode: 'overwrite', format: 'delta' } },
    {
      id: 'customer_value',
      kind: 'aggregate',
      label: 'Customer value',
      position: at,
      config: {
        groupBy: ['customer_id', 'name', 'segment'],
        aggs: [
          { fn: 'sum', column: 'revenue', as: 'lifetime_value' },
          { fn: 'count_distinct', column: 'order_id', as: 'orders' },
        ],
      },
    },
    { id: 'ranked', kind: 'window', label: 'Rank in segment', position: at, config: { fn: 'rank', column: '', partitionBy: ['segment'], orderBy: 'lifetime_value', desc: true, as: 'segment_rank' } },
    { id: 'top10', kind: 'filter', label: 'Top 10 per segment', position: at, config: { match: 'all', conditions: [{ column: 'segment_rank', op: '<=', value: '10' }] } },
    { id: 'out_top', kind: 'output', label: 'gold.top_customers', position: at, config: { table: 'gold.top_customers', mode: 'overwrite', format: 'delta' } },
  ];
  const edges = [
    e('orders', 'latest'),
    e('latest', 'valid'),
    e('valid', 'with_customer', 'left'),
    e('customers', 'with_customer', 'right'),
    e('with_customer', 'with_product', 'left'),
    e('products', 'with_product', 'right'),
    e('with_product', 'revenue'),
    e('revenue', 'gate'),
    e('gate', 'daily'),
    e('daily', 'daily_sorted'),
    e('daily_sorted', 'out_daily'),
    e('gate', 'customer_value'),
    e('customer_value', 'ranked'),
    e('ranked', 'top10'),
    e('top10', 'out_top'),
  ];
  return autoLayout({ name: 'Orders to revenue marts', nodes, edges });
}

export function emptyPipeline(): Pipeline {
  return { name: 'Untitled pipeline', nodes: [], edges: [] };
}

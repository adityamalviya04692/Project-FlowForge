import { NODE_DEFS } from './catalog';
import type { PEdge, Pipeline, PNode } from './types';

/** Upstream nodes in input order (join: left then right). */
export function inputsOf(p: Pipeline, id: string): PNode[] {
  const node = p.nodes.find((n) => n.id === id);
  const edges = p.edges.filter((e) => e.target === id);
  const byId = (eid: string) => p.nodes.find((n) => n.id === eid);
  if (node?.kind === 'join') {
    return ['left', 'right'].map((h) => edges.find((e) => e.targetHandle === h)).map((e) => (e ? byId(e.source) : undefined)).filter((n): n is PNode => !!n);
  }
  return edges.map((e) => byId(e.source)).filter((n): n is PNode => !!n);
}

/** Topological order; nodes on a cycle are returned in `cyclic`. */
export function topoOrder(p: Pipeline): { order: PNode[]; cyclic: PNode[] } {
  const indeg = new Map(p.nodes.map((n) => [n.id, 0]));
  for (const e of p.edges) if (indeg.has(e.target) && indeg.has(e.source)) indeg.set(e.target, indeg.get(e.target)! + 1);
  const queue = p.nodes.filter((n) => indeg.get(n.id) === 0).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const order: PNode[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const e of p.edges.filter((x) => x.source === n.id)) {
      const d = indeg.get(e.target)! - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(p.nodes.find((x) => x.id === e.target)!);
    }
  }
  const done = new Set(order.map((n) => n.id));
  return { order, cyclic: p.nodes.filter((n) => !done.has(n.id)) };
}

export function wouldCreateCycle(p: Pipeline, source: string, target: string): boolean {
  if (source === target) return true;
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of p.edges) if (e.source === cur) stack.push(e.target);
  }
  return false;
}

/** Add an edge, replacing whatever already fills a single-input slot. Returns null if not allowed. */
export function connect(p: Pipeline, source: string, target: string, handle = 'in'): Pipeline | null {
  const t = p.nodes.find((n) => n.id === target);
  const s = p.nodes.find((n) => n.id === source);
  if (!t || !s || s.kind === 'output' || NODE_DEFS[t.kind].inputs === 0) return null;
  if (wouldCreateCycle(p, source, target)) return null;
  const many = NODE_DEFS[t.kind].inputs === 'many';
  const keep = p.edges.filter((e) => !(e.target === target && (many ? e.source === source : (e.targetHandle ?? 'in') === handle)));
  const edge: PEdge = { id: `e_${source}_${target}_${handle}`, source, target, targetHandle: handle };
  return { ...p, edges: [...keep, edge] };
}

export function ancestors(p: Pipeline, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of p.edges) if (e.target === cur && !out.has(e.source)) (out.add(e.source), stack.push(e.source));
  }
  return out;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'step';
}

/** Readable, unique CTE / variable names derived from node labels. */
export function stepNames(p: Pipeline): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const n of topoOrder(p).order.concat(topoOrder(p).cyclic)) {
    const base = /^\d/.test(slug(n.label)) ? `s_${slug(n.label)}` : slug(n.label);
    const k = used.get(base) ?? 0;
    used.set(base, k + 1);
    out.set(n.id, k ? `${base}_${k + 1}` : base);
  }
  return out;
}

export interface Issue {
  nodeId: string;
  severity: 'error' | 'warning';
  message: string;
}

/** Structural and configuration problems, independent of data. */
export function validate(p: Pipeline): Issue[] {
  const issues: Issue[] = [];
  const { cyclic } = topoOrder(p);
  for (const n of cyclic) issues.push({ nodeId: n.id, severity: 'error', message: 'Part of a cycle' });
  for (const n of p.nodes) {
    const def = NODE_DEFS[n.kind];
    const ins = inputsOf(p, n.id);
    if (def.inputs === 1 && ins.length < 1) issues.push({ nodeId: n.id, severity: 'error', message: 'Connect an input' });
    if (def.inputs === 2 && ins.length < 2) issues.push({ nodeId: n.id, severity: 'error', message: 'Connect both the left and the right input' });
    if (def.inputs === 'many' && ins.length < 2) issues.push({ nodeId: n.id, severity: 'error', message: 'Connect at least two inputs' });
    const need = (ok: boolean, message: string) => !ok && issues.push({ nodeId: n.id, severity: 'error', message });
    switch (n.kind) {
      case 'source':
        need(!!n.config.dataset, 'Choose a dataset');
        break;
      case 'filter':
        need(n.config.conditions.length > 0 && n.config.conditions.every((c) => c.column), 'Every condition needs a column');
        break;
      case 'select':
        need(n.config.columns.length > 0, 'Pick at least one column');
        break;
      case 'derive':
        need(n.config.columns.every((c) => c.name && c.expr.trim()), 'Every derived column needs a name and an expression');
        break;
      case 'join':
        need(n.config.keys.length > 0 && n.config.keys.every((k) => k.left && k.right), 'Choose the join keys');
        break;
      case 'aggregate':
        need(n.config.aggs.length > 0 && n.config.aggs.every((a) => a.as && (a.fn === 'count' || a.column)), 'Every aggregation needs a column and a name');
        break;
      case 'dedupe':
        need(n.config.keys.length > 0, 'Choose the key columns');
        break;
      case 'window':
        need(!!n.config.orderBy && !!n.config.as, 'Choose an order column and an output name');
        need(!['running_sum', 'lag', 'lead'].includes(n.config.fn) || !!n.config.column, 'Choose the column to aggregate');
        break;
      case 'sort':
        need(n.config.by.length > 0 && n.config.by.every((b) => b.column), 'Choose the sort columns');
        break;
      case 'quality':
        need(n.config.checks.length > 0 && n.config.checks.every((c) => c.column), 'Every check needs a column');
        break;
      case 'output':
        need(/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/.test(n.config.table), 'Target must look like schema.table');
        if (p.edges.some((e) => e.source === n.id)) issues.push({ nodeId: n.id, severity: 'error', message: 'An output cannot feed other nodes' });
        break;
      default:
        break;
    }
  }
  if (!p.nodes.some((n) => n.kind === 'output')) issues.push({ nodeId: '', severity: 'warning', message: 'Add an Output node to name the table this pipeline writes' });
  return issues;
}

import { useCallback, useEffect, useMemo, type DragEvent } from 'react';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import type { NodeState } from '../engine/run';
import { NODE_DEFS } from '../pipeline/catalog';
import { connect, type Issue } from '../pipeline/graph';
import type { NodeKind, Pipeline, PNode } from '../pipeline/types';
import { DRAG_TYPE } from './Palette';

type StepData = { n: PNode; st?: NodeState; issue?: string };

const fmt = (n: number) => n.toLocaleString('en-US');

export function summary(n: PNode): string {
  switch (n.kind) {
    case 'source':
      return n.config.dataset ? `${n.config.dataset} → ${n.config.table}` : 'choose a dataset';
    case 'filter':
      return n.config.conditions.filter((c) => c.column).map((c) => `${c.column} ${c.op.replace('_', ' ')}${['is_null', 'not_null'].includes(c.op) ? '' : ` ${c.value}`}`).join(n.config.match === 'all' ? ' and ' : ' or ') || 'no conditions';
    case 'select':
      return `${n.config.columns.length} column${n.config.columns.length === 1 ? '' : 's'}`;
    case 'derive':
      return n.config.columns.map((c) => c.name).join(', ');
    case 'join':
      return `${n.config.how} join on ${n.config.keys.map((k) => (k.left === k.right ? k.left : `${k.left}=${k.right}`)).join(', ') || '?'}`;
    case 'aggregate':
      return n.config.groupBy.length ? `by ${n.config.groupBy.join(', ')}` : 'whole table';
    case 'dedupe':
      return `one per ${n.config.keys.join(', ') || '?'}${n.config.orderBy ? `, ${n.config.desc ? 'latest' : 'first'} ${n.config.orderBy}` : ''}`;
    case 'window':
      return `${n.config.fn.replace('_', ' ')} by ${n.config.orderBy || '?'}${n.config.partitionBy.length ? ` per ${n.config.partitionBy.join(', ')}` : ''}`;
    case 'union':
      return n.config.distinct ? 'distinct rows' : 'all rows';
    case 'sort':
      return `${n.config.by.map((b) => `${b.column}${b.desc ? ' ↓' : ' ↑'}`).join(', ')}${n.config.limit ? `, top ${n.config.limit}` : ''}`;
    case 'quality':
      return `${n.config.checks.length} check${n.config.checks.length === 1 ? '' : 's'} · ${n.config.action === 'drop' ? 'drop failing rows' : 'warn only'}`;
    case 'output':
      return `${n.config.mode} ${n.config.table}`;
  }
}

function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const { n, st, issue } = data;
  const def = NODE_DEFS[n.kind];
  const failed = st?.quality?.checks.reduce((s, c) => s + c.failed, 0) ?? 0;
  const blocked = !!st?.error && !st.own;
  const err = issue ?? (st?.error && st.own ? st.error : undefined);
  return (
    <div className={`step ${def.group}${selected ? ' selected' : ''}${err ? ' err' : ''}${blocked ? ' blocked' : ''}`}>
      {def.inputs === 2 ? (
        <>
          <Handle type="target" position={Position.Left} id="left" className="lr" style={{ top: '34%' }} />
          <span className="handle-tag" style={{ top: '34%' }}>L</span>
          <Handle type="target" position={Position.Left} id="right" className="lr" style={{ top: '70%' }} />
          <span className="handle-tag" style={{ top: '70%' }}>R</span>
        </>
      ) : def.inputs !== 0 ? (
        <Handle type="target" position={Position.Left} id="in" />
      ) : null}
      <div className="step-head">
        <span className="glyph">{def.glyph}</span>
        <span className="name" title={n.label}>{n.label}</span>
      </div>
      <div className="step-sub" title={summary(n)}>{summary(n)}</div>
      <div className="step-foot">
        {err ? <span className="bad" title={err}>⚠ {err}</span> : blocked ? <span className="muted">blocked upstream</span> : st?.rows != null ? <span className="ok">{fmt(st.rows)} rows</span> : <span className="muted">…</span>}
        {failed > 0 ? <span className="warn">{fmt(failed)} failed</span> : st?.columns.length ? <span className="muted">{st.columns.length} cols</span> : null}
      </div>
      {n.kind !== 'output' && <Handle type="source" position={Position.Right} id="out" />}
    </div>
  );
}

const nodeTypes = { step: StepNode };

interface Props {
  pipeline: Pipeline;
  states: Map<string, NodeState>;
  issues: Issue[];
  selected: string | null;
  fitKey: number;
  onSelect: (id: string | null) => void;
  onChange: (p: Pipeline) => void;
  onAddAt: (kind: NodeKind, pos: { x: number; y: number }) => void;
  toast: (msg: string) => void;
}

function Inner({ pipeline, states, issues, selected, fitKey, onSelect, onChange, onAddAt, toast }: Props) {
  const rf = useReactFlow();

  const nodes: Node<StepData>[] = useMemo(
    () => pipeline.nodes.map((n) => ({ id: n.id, type: 'step', position: n.position, initialWidth: 210, initialHeight: 76, selected: n.id === selected, data: { n, st: states.get(n.id), issue: issues.find((i) => i.nodeId === n.id && i.severity === 'error')?.message } })),
    [pipeline.nodes, states, issues, selected],
  );

  const edges: Edge[] = useMemo(
    () =>
      pipeline.edges.map((e) => {
        const rows = states.get(e.source)?.rows;
        return { id: e.id, source: e.source, target: e.target, sourceHandle: 'out', targetHandle: e.targetHandle ?? 'in', label: rows != null ? `${fmt(rows)} rows` : undefined, markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 1.6 } };
      }),
    [pipeline.edges, states],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<StepData>>[]) => {
      let p = pipeline;
      let changed = false;
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          p = { ...p, nodes: p.nodes.map((n) => (n.id === c.id ? { ...n, position: c.position! } : n)) };
          changed = true;
        } else if (c.type === 'remove') {
          p = { ...p, nodes: p.nodes.filter((n) => n.id !== c.id), edges: p.edges.filter((e) => e.source !== c.id && e.target !== c.id) };
          changed = true;
          if (selected === c.id) onSelect(null);
        } else if (c.type === 'select' && c.selected) {
          onSelect(c.id);
        }
      }
      if (changed) onChange(p);
    },
    [pipeline, selected, onChange, onSelect],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
      if (removed.size) onChange({ ...pipeline, edges: pipeline.edges.filter((e) => !removed.has(e.id)) });
    },
    [pipeline, onChange],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const next = connect(pipeline, c.source, c.target, c.targetHandle ?? 'in');
      if (next) onChange(next);
      else toast('That connection is not allowed (it would create a cycle, or an Output cannot feed other steps).');
    },
    [pipeline, onChange, toast],
  );

  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_TYPE) as NodeKind;
    if (!kind) return;
    e.preventDefault();
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onAddAt(kind, { x: pos.x - 105, y: pos.y - 30 });
  };

  useEffect(() => {
    // Keep steps readable on wide pipelines; the rest is a pan away.
    const id = requestAnimationFrame(() => rf.fitView({ padding: 0.08, duration: 250, minZoom: 0.6, maxZoom: 1 }));
    return () => cancelAnimationFrame(id);
  }, [fitKey, rf]);

  return (
    <div className="canvas" onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => onSelect(null)}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 96 }} nodeColor={(n) => getComputedStyle(document.documentElement).getPropertyValue(`--g-${NODE_DEFS[(n.data as StepData).n.kind].group.toLowerCase()}`).trim()} />
      </ReactFlow>
      {pipeline.nodes.length === 0 && (
        <div className="empty-canvas">
          <div>
            <h3>Drag steps here from the left</h3>
            <p className="small">Start with a Source, chain transforms, and finish with an Output. Each step runs as you build it.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

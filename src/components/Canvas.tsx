import { useCallback, useEffect, useMemo, type DragEvent, type ReactNode } from 'react';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import type { NodeState } from '../engine/run';
import { NODE_DEFS } from '../pipeline/catalog';
import { connect, type Issue } from '../pipeline/graph';
import type { NodeKind, Pipeline, PNode } from '../pipeline/types';
import { DRAG_TYPE } from './Palette';
import { KindIcon } from './icons';

type StepData = { n: PNode; st?: NodeState; issue?: string; running?: boolean };

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

export const catClass = (kind: NodeKind) => `cat-${NODE_DEFS[kind].group.toLowerCase()}`;

function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const { n, st, issue, running } = data;
  const def = NODE_DEFS[n.kind];
  const failed = st?.quality?.checks.reduce((s, c) => s + c.failed, 0) ?? 0;
  const blocked = !!st?.error && !st.own;
  const err = issue ?? (st?.error && st.own ? st.error : undefined);
  return (
    <div className={`step ${catClass(n.kind)}${selected ? ' selected' : ''}${err ? ' err' : ''}${blocked ? ' blocked' : ''}${running ? ' running' : ''}`}>
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
      <div className="step-top">
        <span className="icon-tile"><KindIcon kind={n.kind} size={16} /></span>
        <div className="step-titles">
          <div className="step-kind">{def.label}</div>
          <div className="step-name" title={n.label}>{n.label}</div>
        </div>
      </div>
      <div className="step-sub" title={summary(n)}>{summary(n)}</div>
      <div className="step-foot">
        {err ? (
          <span className="pill bad" title={err}>● {err}</span>
        ) : blocked ? (
          <span className="pill idle">blocked upstream</span>
        ) : st?.rows != null ? (
          <span className="pill ok"><span className="dot" />{fmt(st.rows)} rows</span>
        ) : (
          <span className="pill idle">waiting…</span>
        )}
        {failed > 0 ? <span className="pill warn">{fmt(failed)} failed</span> : st?.columns.length ? <span className="step-cols">{st.columns.length} cols</span> : null}
      </div>
      {n.kind !== 'output' && <Handle type="source" position={Position.Right} id="out" />}
    </div>
  );
}

const nodeTypes = { step: StepNode };

interface Props {
  toolbar?: ReactNode;
  pipeline: Pipeline;
  states: Map<string, NodeState>;
  issues: Issue[];
  selected: string | null;
  running?: boolean;
  fitKey: number;
  onSelect: (id: string | null) => void;
  onChange: (p: Pipeline) => void;
  onAddAt: (kind: NodeKind, pos: { x: number; y: number }) => void;
  toast: (msg: string) => void;
}

function Inner({ pipeline, states, issues, selected, running = false, fitKey, onSelect, onChange, onAddAt, toast, toolbar }: Props) {
  const rf = useReactFlow();

  const nodes: Node<StepData>[] = useMemo(
    () => pipeline.nodes.map((n) => ({ id: n.id, type: 'step', position: n.position, initialWidth: 224, initialHeight: 96, selected: n.id === selected, data: { n, st: states.get(n.id), running, issue: issues.find((i) => i.nodeId === n.id && i.severity === 'error')?.message } })),
    [pipeline.nodes, states, issues, selected, running],
  );

  const edges: Edge[] = useMemo(
    () =>
      pipeline.edges.map((e) => {
        const rows = states.get(e.source)?.rows;
        const src = pipeline.nodes.find((n) => n.id === e.source);
        const color = src ? `var(--cat-${NODE_DEFS[src.kind].group.toLowerCase()})` : 'var(--text-muted)';
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: 'out',
          targetHandle: e.targetHandle ?? 'in',
          type: 'step',
          animated: running,
          label: rows != null ? `${fmt(rows)} rows` : undefined,
          labelBgPadding: [7, 3] as [number, number],
          labelBgBorderRadius: 0,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          style: { stroke: color },
        };
      }),
    [pipeline.edges, pipeline.nodes, states, running],
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
    onAddAt(kind, { x: pos.x - 112, y: pos.y - 40 });
  };

  useEffect(() => {
    // Start at the inputs of wide pipelines; Fit View still shows the whole graph.
    const id = requestAnimationFrame(() => rf.fitView({ nodes: pipeline.nodes.slice(0, 5).map((n) => ({ id: n.id })), padding: 0.15, duration: 250, minZoom: 0.5, maxZoom: 1 }));
    return () => cancelAnimationFrame(id);
  }, [fitKey, rf]);

  return (
    <div className="canvas" onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))} onDrop={onDrop}>
      <div className="terminal-title canvas-title"><span className="canvas-caption">▦ Graph_matrix // workspace_01</span><div className="canvas-actions" role="group" aria-label="Canvas layout">{toolbar}</div></div>
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
        <Background gap={22} size={1.4} color="var(--canvas-dot)" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap pannable zoomable position="bottom-right" style={{ width: 140, height: 80 }} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" nodeBorderRadius={0} nodeColor={() => '#55cc77'} />
      </ReactFlow>
      {pipeline.nodes.length === 0 && (
        <div className="empty-canvas">
          <div>
            <div className="empty-icons">
              <span className="icon-tile cat-input"><KindIcon kind="source" /></span>
              <span className="icon-tile cat-transform"><KindIcon kind="filter" /></span>
              <span className="icon-tile cat-output"><KindIcon kind="output" /></span>
            </div>
            <h3>Drag steps here to start building</h3>
            <p className="small muted">Start with a Source, chain transforms, and finish with an Output. Every step runs on DuckDB as you build it.</p>
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

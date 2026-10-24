import { useEffect, useRef, useState } from 'react';
import './landing.css';

/* FlowForge's front page, written as the brochure for its imaginary 1980s data terminal. The one moving
   thing is the CRT: it powers on, boots FLOWFORGE OS and draws the demo pipeline step by step (row counts
   are the real ones for the bundled sample data), then idles with data flowing. Everything else waits
   for the visitor. Reduced motion skips straight to the running pipeline. */

const GITHUB = 'https://github.com/adityamalviya04692/Project-FlowForge';
const APP = '#/app';

const BOOT = ['FLOWFORGE OS 1.0   (C) 2026 FLOWFORGE SYSTEMS', 'MEMORY TEST .............. 4096K OK', 'DUCKDB-WASM ENGINE ........ READY', 'MOUNT /sample/orders.csv .. 3,200 ROWS', 'LOAD PIPELINE orders_to_daily_revenue'];
const NODES = [
  { id: 'Orders', kind: 'SOURCE', rows: '3,200', x: 16, y: 26 },
  { id: 'Latest version', kind: 'DEDUPE', rows: '3,000', x: 196, y: 26 },
  { id: 'Valid orders', kind: 'FILTER', rows: '2,751', x: 376, y: 26 },
  { id: 'Add customer', kind: 'JOIN', rows: '2,751', x: 16, y: 150 },
  { id: 'Daily revenue', kind: 'AGGREGATE', rows: '92', x: 196, y: 150 },
  { id: 'gold.daily_revenue', kind: 'OUTPUT', rows: 'DELTA', x: 376, y: 150 },
];
const W = 150;
const H = 62;
const BOOT_END = 2.5;
const STEP = 0.42; // seconds per pipeline step after the boot text

const CODE: Record<string, string> = {
  'DuckDB SQL': `WITH latest AS (
  SELECT * EXCLUDE (rn) FROM (
    SELECT *, row_number() OVER (PARTITION BY order_id ORDER BY updated_at DESC) AS rn
    FROM raw.orders) WHERE rn = 1
), valid AS (
  SELECT * FROM latest WHERE status <> 'cancelled' AND quantity > 0
)
SELECT order_date, sum(quantity * unit_price) AS revenue, count(*) AS orders
FROM valid LEFT JOIN raw.customers USING (customer_id)
GROUP BY order_date;`,
  PySpark: `w = Window.partitionBy("order_id").orderBy(F.col("updated_at").desc())
latest = orders.withColumn("rn", F.row_number().over(w)).filter("rn = 1").drop("rn")
valid = latest.filter((F.col("status") != "cancelled") & (F.col("quantity") > 0))
daily = (valid.join(customers, "customer_id", "left")
    .groupBy("order_date")
    .agg(F.sum(F.col("quantity") * F.col("unit_price")).alias("revenue"),
         F.count("*").alias("orders")))
daily.write.format("delta").mode("overwrite").saveAsTable("gold.daily_revenue")`,
  dbt: `-- models/gold/daily_revenue.sql
{{ config(materialized='table') }}
select order_date,
       sum(quantity * unit_price) as revenue,
       count(*) as orders
from {{ ref('valid_orders') }}
left join {{ ref('customers') }} using (customer_id)
group by order_date

-- models/gold/schema.yml: not_null and unique tests on order_date`,
};

const SPECS: [string, string][] = [
  ['Engine', 'DuckDB-WASM, running in your browser tab'],
  ['Transforms', 'Filter, select, derive, dedupe, join, union, aggregate, window, sort, pivot'],
  ['Quality gates', 'Not-null, unique, accepted range and row-count checks that stop a run'],
  ['Exports', 'DuckDB SQL, Spark SQL, PySpark and a dbt project as a zip'],
  ['Inputs', 'CSV, Parquet and JSON files, or the bundled sample warehouse'],
  ['Storage', 'Your browser. Nothing is uploaded'],
  ['Display', 'P1 green, P3 amber or P4 white phosphor, scanlines optional'],
  ['Price', 'Free and open source (MIT)'],
];

function useClock(reduce: boolean) {
  const [t, setT] = useState(reduce ? 99 : 0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const s = (now - start) / 1000;
      setT(s);
      if (s < BOOT_END + NODES.length * STEP + 1) raf = requestAnimationFrame(tick); // stop once settled
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);
  return t;
}

function Crt() {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = useClock(reduce);
  const done = (i: number) => t >= BOOT_END + (i + 1) * STEP;
  const running = (i: number) => t >= BOOT_END + i * STEP && !done(i);
  const settled = done(NODES.length - 1);
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]];
  const path = ([a, b]: [number, number]) => {
    const A = NODES[a];
    const B = NODES[b];
    if (A.y === B.y) return `M${A.x + W} ${A.y + H / 2} L${B.x} ${B.y + H / 2}`;
    return `M${A.x + W / 2} ${A.y + H} C${A.x + W / 2} ${A.y + H + 40} ${B.x + W / 2} ${B.y - 40} ${B.x + W / 2} ${B.y}`;
  };
  return (
    <div className="ff-crt" aria-label="The FlowForge workstation booting and running the demo pipeline" role="img">
      <div className="ff-bezel">
        <div className={`ff-screen${reduce ? ' on' : ''}`}>
          <div className="ff-power" aria-hidden="true" />
          {t < BOOT_END + 0.2 ? (
            <pre className="ff-boot">
              {BOOT.map((line, i) => {
                const start = 0.45 + i * 0.36;
                const shown = Math.round(Math.max(0, Math.min(1, (t - start) / 0.3)) * line.length);
                return shown > 0 ? <span key={line}>{line.slice(0, shown)}{'\n'}</span> : null;
              })}
              <i className="ff-cursor" />
            </pre>
          ) : (
            <svg viewBox="0 0 542 236" className="ff-graph">
              {edges.map((e, k) => (
                <g key={k}>
                  <path d={path(e)} className={`ff-edge${done(e[0]) ? ' drawn' : ''}`} pathLength={1} />
                  {settled && !reduce && (
                    <circle r="3" className="ff-packet">
                      <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${k * 0.27}s`} path={path(e)} />
                    </circle>
                  )}
                </g>
              ))}
              {NODES.map((n, i) => (
                <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
                  {/* the inner group carries the CSS entrance; a CSS transform would replace the translate above */}
                  <g className={`ff-node${t >= BOOT_END + i * STEP ? ' in' : ''}${running(i) ? ' run' : ''}${done(i) ? ' ok' : ''}`}>
                    <rect width={W} height={H} />
                    <text x="10" y="18" className="ff-kind">{n.kind}</text>
                    <text x="10" y="37" className="ff-name">{n.id}</text>
                    <text x="10" y="53" className="ff-rows">{done(i) ? (n.rows === 'DELTA' ? 'WRITTEN · DELTA' : `${n.rows} ROWS`) : running(i) ? 'RUNNING…' : ''}</text>
                  </g>
                </g>
              ))}
              {settled && <text x="16" y="230" className="ff-status">RUN OK · 6 STEPS · ROWS VERIFIED AGAINST /sample</text>}
            </svg>
          )}
        </div>
      </div>
      <div className="ff-chin">
        <span className="ff-badge">FORGE–80</span>
        <span className={`ff-led${t > 0.2 ? ' on' : ''}`} aria-hidden="true" />
      </div>
    </div>
  );
}

function CodeTabs() {
  const names = Object.keys(CODE);
  const [tab, setTab] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ x: 0, w: 0 });
  useEffect(() => {
    const el = tabs.current?.children[tab] as HTMLElement | undefined;
    if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth });
  }, [tab]);
  return (
    <div className="ff-code">
      <div className="ff-tabs" role="tablist" ref={tabs}>
        {names.map((n, i) => (
          <button key={n} role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{n}</button>
        ))}
        <i className="ff-tab-bar" style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} aria-hidden="true" />
      </div>
      <pre key={tab} className="ff-code-body" role="tabpanel"><code>{CODE[names[tab]]}</code></pre>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="ff-landing">
      <nav className="ff-nav">
        <a className="ff-brand" href="#/"><span className="ff-mark" aria-hidden="true" />FlowForge</a>
        <div className="ff-links">
          <a href="#code">Generated code</a>
          <a href="#specs">Specifications</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <a className="ff-btn" href={APP}>Power on</a>
      </nav>

      <header className="ff-hero">
        <div className="ff-copy">
          <p className="ff-model">Model FF–8086 · browser workstation</p>
          <h1>Draw the pipeline. Ship the code.</h1>
          <p className="ff-lede">FlowForge is a visual ETL workstation that runs every step on DuckDB inside your browser, shows the rows at each node, and writes the SQL, PySpark and dbt you would have written by hand.</p>
          <div className="ff-cta">
            <a className="ff-btn big" href={APP}>Power on the workstation</a>
            <a className="ff-btn big ghost" href={GITHUB} target="_blank" rel="noreferrer">Read the source</a>
          </div>
        </div>
        <Crt />
      </header>

      <section className="ff-steps" aria-label="How it works">
        {[
          ['Load', 'Drop CSV, Parquet or JSON files, or start from the sample warehouse of orders, customers and products.'],
          ['Wire', 'Connect transforms on the canvas. Each node runs on DuckDB and previews its rows, schema and quality checks.'],
          ['Export', 'Download the pipeline as DuckDB SQL, Spark SQL, PySpark or a dbt project, ready to review and deploy.'],
        ].map(([h, p], i) => (
          <article key={h}>
            <span className="ff-step-n">{i + 1}</span>
            <h3>{h}</h3>
            <p>{p}</p>
          </article>
        ))}
      </section>

      <section className="ff-section" id="code">
        <div className="ff-section-head">
          <h2>The same pipeline, three ways out.</h2>
          <p>Excerpts of what FlowForge generates for the demo pipeline. Switch targets; the logic stays the same.</p>
        </div>
        <CodeTabs />
      </section>

      <section className="ff-section" id="specs">
        <div className="ff-section-head">
          <h2>Specifications</h2>
        </div>
        <dl className="ff-specs">
          {SPECS.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </section>

      <section className="ff-final">
        <h2>Your data never leaves the terminal.</h2>
        <a className="ff-btn big" href={APP}>Power on</a>
      </section>

      <footer className="ff-foot">
        <span>FlowForge · MIT licensed</span>
        <a href="https://adityamalviya04692.github.io/Portfolio/" target="_blank" rel="noreferrer">Built by Aditya Malviya</a>
      </footer>
    </div>
  );
}

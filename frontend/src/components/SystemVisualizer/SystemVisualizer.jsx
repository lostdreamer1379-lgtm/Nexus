import { useEffect, useMemo, useState } from "react";
import {
  Activity, BrainCircuit, CheckCircle2, Database, Globe2, MessageSquare,
  Network, Radio, Server, Sparkles, Upload, Workflow, XCircle,
} from "lucide-react";
import { clearSystemEvents, subscribeSystemEvents } from "../../utils/systemEvents.js";

const NODES = [
  { id: "input", label: "Input", icon: MessageSquare, x: 10, y: 50, color: "#8b5cf6" },
  { id: "router", label: "Router", icon: Workflow, x: 27, y: 25, color: "#06b6d4" },
  { id: "memory", label: "Memory", icon: BrainCircuit, x: 27, y: 75, color: "#ec4899" },
  { id: "knowledge", label: "Knowledge", icon: Database, x: 48, y: 22, color: "#22c55e" },
  { id: "web", label: "Live web", icon: Globe2, x: 48, y: 78, color: "#f59e0b" },
  { id: "model", label: "Model", icon: Sparkles, x: 70, y: 50, color: "#a78bfa" },
  { id: "output", label: "Response", icon: CheckCircle2, x: 90, y: 50, color: "#14b8a6" },
];

const LINKS = [
  ["input", "router"], ["router", "memory"], ["router", "knowledge"],
  ["router", "web"], ["memory", "model"], ["knowledge", "model"],
  ["web", "model"], ["model", "output"],
];

const ICONS = { chat: MessageSquare, upload: Upload, retrieval: Database, web: Globe2, model: Sparkles, memory: BrainCircuit, graph: Network, system: Activity };

function ago(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 2 ? "just now" : `${seconds}s ago`;
}

export default function SystemVisualizer() {
  const [events, setEvents] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeSystemEvents((event) => {
    if (event.type === "reset") setEvents([]);
    else setEvents((current) => [...current.slice(-59), event]);
  }), []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeNodes = useMemo(() => {
    const active = new Set(["input"]);
    events.filter((event) => now - event.timestamp < 3500).forEach((event) => {
      if (event.node) active.add(event.node);
    });
    return active;
  }, [events, now]);

  const latest = events.slice(-1)[0];
  const counts = events.reduce((result, event) => {
    result[event.kind || "system"] = (result[event.kind || "system"] || 0) + 1;
    return result;
  }, {});

  return (
    <div className="visualizer-page">
      <style>{`
        .visualizer-page { height: 100%; overflow-y: auto; padding: 28px; background: radial-gradient(circle at 50% 20%, rgba(99,102,241,.12), transparent 42%), var(--bg-0); }
        .visualizer-inner { max-width: 1280px; margin: 0 auto; }
        .viz-header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:22px; }
        .viz-header h1 { margin:0 0 6px; font-size:24px; letter-spacing:-.03em; }
        .viz-header p { margin:0; color:var(--text-secondary); font-size:14px; }
        .viz-live { display:flex; align-items:center; gap:7px; color:#34d399; font-size:12px; border:1px solid rgba(52,211,153,.3); padding:7px 10px; border-radius:999px; background:rgba(52,211,153,.08); }
        .viz-dot { width:7px; height:7px; border-radius:50%; background:#34d399; box-shadow:0 0 12px #34d399; animation:viz-pulse 1.3s infinite; }
        .viz-card { border:1px solid var(--border-subtle); background:rgba(18,20,30,.68); border-radius:18px; box-shadow:0 18px 70px rgba(0,0,0,.2); }
        .viz-map { position:relative; min-height:470px; overflow:hidden; }
        .viz-grid { position:absolute; inset:0; opacity:.2; background-image:linear-gradient(rgba(148,163,184,.16) 1px, transparent 1px),linear-gradient(90deg,rgba(148,163,184,.16) 1px,transparent 1px); background-size:42px 42px; }
        .viz-lines { position:absolute; inset:0; width:100%; height:100%; }
        .viz-link { stroke:var(--border); stroke-width:1.2; opacity:.7; }
        .viz-link.active { stroke:#8b5cf6; stroke-width:2.5; stroke-dasharray:8 8; animation:viz-flow 1s linear infinite; }
        .viz-node { position:absolute; transform:translate(-50%,-50%); width:112px; text-align:center; transition:transform .25s, filter .25s; }
        .viz-node.active { transform:translate(-50%,-50%) scale(1.12); filter:drop-shadow(0 0 16px var(--node-color)); }
        .viz-node-orb { width:48px; height:48px; margin:auto; display:flex; align-items:center; justify-content:center; border-radius:50%; color:var(--node-color); border:1px solid color-mix(in srgb, var(--node-color) 65%, transparent); background:color-mix(in srgb, var(--node-color) 13%, var(--bg-1)); }
        .viz-node-label { display:block; margin-top:8px; font-size:12px; color:var(--text-secondary); }
        .viz-node.active .viz-node-label { color:var(--text-primary); }
        .viz-radar { position:absolute; width:240px; height:240px; border-radius:50%; border:1px solid rgba(139,92,246,.18); left:50%; top:50%; transform:translate(-50%,-50%); animation:viz-radar 4s ease-in-out infinite; }
        .viz-bottom { display:grid; grid-template-columns:1.2fr .8fr; gap:16px; margin-top:16px; }
        .viz-panel { padding:16px; }
        .viz-panel h2 { font-size:13px; margin:0 0 12px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-tertiary); }
        .viz-status { display:flex; align-items:center; gap:10px; min-height:36px; color:var(--text-secondary); font-size:13px; }
        .viz-status strong { color:var(--text-primary); }
        .viz-event { display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid var(--border-subtle); font-size:12px; }
        .viz-event-icon { width:26px; height:26px; display:flex; align-items:center; justify-content:center; border-radius:8px; background:var(--bg-2); color:var(--accent); }
        .viz-event-main { flex:1; min-width:0; }
        .viz-event-main strong { display:block; color:var(--text-primary); font-weight:600; }
        .viz-event-main span { color:var(--text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
        .viz-clear { float:right; border:0; background:none; color:var(--text-tertiary); cursor:pointer; font-size:12px; }
        .viz-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
        .viz-stat { padding:12px; border-radius:12px; background:var(--bg-2); }
        .viz-stat b { display:block; font-size:20px; color:var(--text-primary); }
        .viz-stat span { color:var(--text-tertiary); font-size:11px; }
        @keyframes viz-pulse { 50% { opacity:.35; transform:scale(.7); } }
        @keyframes viz-flow { to { stroke-dashoffset:-16; } }
        @keyframes viz-radar { 50% { transform:translate(-50%,-50%) scale(1.45); opacity:.2; } }
        @media (max-width:760px) { .visualizer-page { padding:16px; } .viz-map { min-height:390px; } .viz-bottom { grid-template-columns:1fr; } .viz-node { width:80px; } .viz-node-orb { width:40px; height:40px; } .viz-stats { grid-template-columns:repeat(2,1fr); } .viz-header { flex-direction:column; } }
      `}</style>
      <div className="visualizer-inner">
        <div className="viz-header">
          <div><h1>System Visualizer</h1><p>Watch Nexus AI route, retrieve, reason, and respond in real time.</p></div>
          <div className="viz-live"><span className="viz-dot" /> LIVE SYSTEM TELEMETRY</div>
        </div>
        <div className="viz-card viz-map">
          <div className="viz-grid" /><div className="viz-radar" />
          <svg className="viz-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
            {LINKS.map(([from, to]) => {
              const a = NODES.find((node) => node.id === from);
              const b = NODES.find((node) => node.id === to);
              const active = activeNodes.has(from) && activeNodes.has(to);
              return <line key={`${from}-${to}`} className={`viz-link ${active ? "active" : ""}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
          </svg>
          {NODES.map((node) => {
            const Icon = node.icon;
            return <div key={node.id} className={`viz-node ${activeNodes.has(node.id) ? "active" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%`, "--node-color": node.color }}>
              <div className="viz-node-orb"><Icon size={21} /></div><span className="viz-node-label">{node.label}</span>
            </div>;
          })}
        </div>
        <div className="viz-bottom">
          <div className="viz-card viz-panel">
            <h2>Current operation</h2>
            <div className="viz-status"><Radio size={16} color="var(--accent)" /><span>{latest ? <><strong>{latest.title}</strong> — {latest.detail || "processing"}</> : "Waiting for activity. Ask a question or upload a document."}</span></div>
            <div className="viz-stats">
              <div className="viz-stat"><b>{counts.chat || 0}</b><span>chat events</span></div><div className="viz-stat"><b>{counts.retrieval || 0}</b><span>retrievals</span></div><div className="viz-stat"><b>{counts.model || 0}</b><span>model events</span></div><div className="viz-stat"><b>{events.length}</b><span>total signals</span></div>
            </div>
          </div>
          <div className="viz-card viz-panel">
            <h2>Live event stream <button className="viz-clear" onClick={clearSystemEvents}>Clear</button></h2>
            {events.length === 0 ? <div className="viz-status">No events yet.</div> : events.slice(-7).reverse().map((event) => {
              const Icon = ICONS[event.kind] || Server;
              return <div className="viz-event" key={event.id}><div className="viz-event-icon"><Icon size={14} /></div><div className="viz-event-main"><strong>{event.title}</strong><span>{event.detail || event.status || "signal"} · {ago(event.timestamp)}</span></div>{event.status === "error" ? <XCircle size={14} color="var(--danger)" /> : <CheckCircle2 size={14} color="var(--success)" />}</div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

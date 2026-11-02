import { useEffect, useMemo, useState } from "react";
import { Boxes, Search, Plus, CheckCheck, ChevronDown, ChevronRight, Minus } from "lucide-react";
import { api } from "../../api/client";
import ModelCard from "./ModelCard.jsx";
import RegisterModelModal from "./RegisterModelModal.jsx";

const FILTERS = [
  { value: "all", label: "All models" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
  { value: "unknown", label: "Unknown pricing" },
];
const GROUPS_KEY = "nexus-model-groups";
const ASSIGNMENTS_KEY = "nexus-model-group-assignments";
const DEFAULT_GROUPS = [
  { id: "general", name: "General chat" },
  { id: "vision", name: "Vision and multimodal" },
  { id: "tools", name: "Tools and agents" },
  { id: "free", name: "Free models" },
];

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

export default function ModelLibrary() {
  const [models, setModels] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [connectionFilter, setConnectionFilter] = useState("all");
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [groups, setGroups] = useState(() => readStorage(GROUPS_KEY, DEFAULT_GROUPS));
  const [assignments, setAssignments] = useState(() => readStorage(ASSIGNMENTS_KEY, {}));
  const [collapsed, setCollapsed] = useState({});
  const [newGroupName, setNewGroupName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [modelList, connectionList] = await Promise.all([api.get("/api/v1/models"), api.get("/api/v1/providers/connections")]);
      setModels(modelList);
      setConnections(connectionList);
    } catch (err) {
      setActionError(err?.message || "Could not load models.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)), [groups]);
  useEffect(() => localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments)), [assignments]);

  const connectionNameById = useMemo(() => Object.fromEntries(connections.map((c) => [c.id, c.connection_name])), [connections]);
  const filtered = models.filter((m) => {
    if (filter !== "all" && m.pricing_tier !== filter) return false;
    if (connectionFilter !== "all" && m.connection_id !== connectionFilter) return false;
    return !search || m.display_name.toLowerCase().includes(search.toLowerCase());
  });

  const groupFor = (model) => {
    if (assignments[model.id]) return assignments[model.id];
    if (model.supports_vision) return "vision";
    if (model.supports_tools) return "tools";
    if (model.pricing_tier === "free") return "free";
    return "general";
  };

  const toggleEnabled = async (model) => {
    try {
      setActionError(null);
      const updated = await api.patch(`/api/v1/models/${model.id}`, { enabled: !model.enabled });
      setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setActionError(err?.message || "Could not update this model.");
    }
  };

  const toggleAll = async (enabled) => {
    setActionError(null);
    setUpdatingAll(true);
    try {
      const updated = await api.post(`/api/v1/models/bulk-toggle?enabled=${enabled}`);
      setModels(updated);
    } catch (err) {
      setActionError(err?.message || `Could not ${enabled ? "enable" : "disable"} models.`);
    } finally {
      setUpdatingAll(false);
    }
  };

  const toggleGroup = async (groupModels, enabled) => {
    setActionError(null);
    setUpdatingAll(true);
    try {
      const ids = groupModels.map((model) => model.id).join(",");
      const updated = await api.post(`/api/v1/models/bulk-toggle?enabled=${enabled}&model_ids=${encodeURIComponent(ids)}`);
      const updatedById = Object.fromEntries(updated.map((model) => [model.id, model]));
      setModels((prev) => prev.map((model) => updatedById[model.id] || model));
    } catch (err) {
      setActionError(err?.message || "Could not update this section.");
    } finally {
      setUpdatingAll(false);
    }
  };

  const assignModel = (modelId, groupId) => {
    setAssignments((prev) => {
      const next = { ...prev };
      if (groupId) next[modelId] = groupId;
      else delete next[modelId];
      return next;
    });
  };

  const createGroup = (event) => {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setGroups((prev) => [...prev, { id: `group-${Date.now()}`, name }]);
    setNewGroupName("");
  };

  const removeModel = async (model) => {
    if (!window.confirm(`Remove "${model.display_name}" from your library?`)) return;
    try {
      await api.delete(`/api/v1/models/${model.id}`);
      setModels((prev) => prev.filter((m) => m.id !== model.id));
    } catch (err) {
      setActionError(err?.message || "Could not remove this model.");
    }
  };

  const renameModel = async (model, newName) => {
    try {
      const updated = await api.patch(`/api/v1/models/${model.id}`, { display_name: newName });
      setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setActionError(err?.message || "Could not rename this model.");
    }
  };

  return (
    <div className="page">
      <style>{`
        .page { height: 100%; overflow-y: auto; padding: var(--space-6) var(--space-5); }
        .page-inner { max-width: 920px; margin: 0 auto; }
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-5); gap: var(--space-3); flex-wrap: wrap; }
        .page-header h1 { font-size: 20px; margin: 0 0 4px; }
        .page-header p { color: var(--text-secondary); font-size: 14px; margin: 0; }
        .model-actions, .model-filters, .group-form { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
        .model-search { position: relative; margin-bottom: var(--space-4); max-width: 320px; }
        .model-search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); }
        .model-search input { padding-left: 34px; }
        .model-filters { margin-bottom: var(--space-4); }
        .filter-pill { padding: 6px 13px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-2); font-size: 13px; color: var(--text-secondary); cursor: pointer; }
        .filter-pill.active { background: var(--accent-dim); border-color: var(--accent); color: var(--text-primary); }
        .model-sections { display: flex; flex-direction: column; gap: var(--space-3); }
        .model-section { padding: 0; overflow: hidden; }
        .model-section-header { width: 100%; display: flex; align-items: center; gap: 8px; padding: 12px 16px; color: var(--text-primary); background: transparent; border: 0; cursor: pointer; text-align: left; }
        .model-section-count { color: var(--text-tertiary); font-size: 12px; }
        .model-section-actions { margin-left: auto; display: flex; gap: 4px; }
        .model-grid { display: flex; flex-direction: column; gap: var(--space-3); padding: 0 12px 12px; }
        @media (max-width: 640px) { .page { padding: var(--space-4) var(--space-3); } .model-section-actions .btn { padding: 5px 7px; font-size: 11px; } }
      `}</style>
      <div className="page-inner">
        <div className="page-header">
          <div><h1>Model Library</h1><p>Organize and control the models available in chat.</p></div>
          <div className="model-actions">
            <button className="btn" onClick={() => toggleAll(true)} disabled={updatingAll || models.every((m) => m.enabled)}><CheckCheck size={16} /> {updatingAll ? "Updating…" : "Enable all"}</button>
            <button className="btn" onClick={() => toggleAll(false)} disabled={updatingAll || models.every((m) => !m.enabled)}><Minus size={16} /> Disable all</button>
            <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)} disabled={connections.length === 0}><Plus size={16} /> Register model</button>
          </div>
        </div>
        <div className="model-search"><Search size={15} /><input className="input" placeholder="Search models" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="model-filters">
          {FILTERS.map((f) => <button key={f.value} className={`filter-pill ${filter === f.value ? "active" : ""}`} onClick={() => setFilter(f.value)}>{f.label}</button>)}
          {connections.length > 1 && <select className="input filter-pill" value={connectionFilter} onChange={(e) => setConnectionFilter(e.target.value)}><option value="all">All connections</option>{connections.map((c) => <option key={c.id} value={c.id}>{c.connection_name}</option>)}</select>}
        </div>
        <form className="group-form" onSubmit={createGroup} style={{ marginBottom: "var(--space-4)", maxWidth: 430 }}>
          <input className="input" placeholder="Create a custom model box" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
          <button className="btn" type="submit"><Plus size={15} /> Add box</button>
        </form>
        {actionError && <p className="error-text">{actionError}</p>}
        {loading ? <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-6)" }}><div className="spinner" /></div> :
          connections.length === 0 ? <div className="empty-state card"><Boxes size={28} color="var(--text-tertiary)" /><h3>Connect a provider first</h3><p>Add a provider to discover models.</p></div> :
          filtered.length === 0 ? <div className="empty-state card"><Boxes size={28} color="var(--text-tertiary)" /><h3>No models match</h3></div> :
          <div className="model-sections">{groups.map((group) => {
            const sectionModels = filtered.filter((m) => groupFor(m) === group.id).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.display_name.localeCompare(b.display_name));
            if (!sectionModels.length) return null;
            const isCollapsed = collapsed[group.id];
            return <section className="model-section card" key={group.id}>
              <div className="model-section-header" role="button" tabIndex={0} onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] })); }}>
                {isCollapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}<strong>{group.name}</strong><span className="model-section-count">{sectionModels.length} models</span>
                <span className="model-section-actions">
                  <span className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); toggleGroup(sectionModels, true); }}>Enable section</span>
                  <span className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); toggleGroup(sectionModels, false); }}>Disable section</span>
                </span>
              </div>
              {!isCollapsed && <div className="model-grid">{sectionModels.map((m) => <ModelCard key={m.id} model={m} connectionName={connectionNameById[m.connection_id]} groups={groups} groupId={groupFor(m)} onGroupChange={(id) => assignModel(m.id, id)} onToggle={() => toggleEnabled(m)} onRemove={() => removeModel(m)} onRename={(name) => renameModel(m, name)} />)}</div>}
            </section>;
          })}</div>}
      </div>
      {showRegisterModal && <RegisterModelModal connections={connections} onClose={() => setShowRegisterModal(false)} onRegistered={(model) => { setModels((prev) => [model, ...prev]); setShowRegisterModal(false); }} />}
    </div>
  );
}

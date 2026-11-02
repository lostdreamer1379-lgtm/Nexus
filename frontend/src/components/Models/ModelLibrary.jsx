import { useEffect, useMemo, useState } from "react";
import { Boxes, Search, Plus, CheckCheck } from "lucide-react";
import { api } from "../../api/client";
import ModelCard from "./ModelCard.jsx";
import RegisterModelModal from "./RegisterModelModal.jsx";

const FILTERS = [
  { value: "all", label: "All models" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
  { value: "unknown", label: "Unknown pricing" },
];

export default function ModelLibrary() {
  const [models, setModels] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [connectionFilter, setConnectionFilter] = useState("all");
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [enablingAll, setEnablingAll] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [modelList, connectionList] = await Promise.all([
        api.get("/api/v1/models"),
        api.get("/api/v1/providers/connections"),
      ]);
      setModels(modelList);
      setConnections(connectionList);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const connectionNameById = useMemo(() => Object.fromEntries(connections.map((c) => [c.id, c.connection_name])), [connections]);

  const filtered = models.filter((m) => {
    if (filter !== "all" && m.pricing_tier !== filter) return false;
    if (connectionFilter !== "all" && m.connection_id !== connectionFilter) return false;
    if (search && !m.display_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleEnabled = async (model) => {
    setActionError(null);
    const updated = await api.patch(`/api/v1/models/${model.id}`, { enabled: !model.enabled });
    setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const enableAll = async () => {
    const disabledModels = models.filter((model) => !model.enabled);
    if (disabledModels.length === 0) return;
    setActionError(null);
    setEnablingAll(true);
    try {
      const updated = await Promise.all(
        disabledModels.map((model) => api.patch(`/api/v1/models/${model.id}`, { enabled: true }))
      );
      const updatedById = Object.fromEntries(updated.map((model) => [model.id, model]));
      setModels((prev) => prev.map((model) => updatedById[model.id] || model));
    } catch (err) {
      setActionError(err?.message || "Some models could not be enabled.");
      await load();
    } finally {
      setEnablingAll(false);
    }
  };

  const removeModel = async (model) => {
    if (!window.confirm(`Remove "${model.display_name}" from your library?`)) return;
    await api.delete(`/api/v1/models/${model.id}`);
    setModels((prev) => prev.filter((m) => m.id !== model.id));
  };

  const renameModel = async (model, newName) => {
    const updated = await api.patch(`/api/v1/models/${model.id}`, { display_name: newName });
    setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  return (
    <div className="page">
      <style>{`
        .page { height: 100%; overflow-y: auto; padding: var(--space-6) var(--space-5); }
        .page-inner { max-width: 880px; margin: 0 auto; }
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-5); gap: var(--space-3); flex-wrap: wrap; }
        .page-header h1 { font-size: 20px; margin: 0 0 4px; }
        .page-header p { color: var(--text-secondary); font-size: 14px; margin: 0; }
        .model-filters { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); flex-wrap: wrap; }
        .filter-pill {
          padding: 6px 13px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-2);
          font-size: 13px; color: var(--text-secondary); cursor: pointer;
        }
        .filter-pill.active { background: var(--accent-dim); border-color: var(--accent); color: var(--text-primary); }
        .model-search { position: relative; margin-bottom: var(--space-4); max-width: 320px; }
        .model-search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); }
        .model-search input { padding-left: 34px; }
        .model-grid { display: flex; flex-direction: column; gap: var(--space-3); }
        .model-actions { display: flex; gap: var(--space-2); align-items: center; }
      `}</style>
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Model Library</h1>
            <p>Enable the models you want available in chat. Disabling one doesn&apos;t remove its provider connection.</p>
          </div>
          <div className="model-actions">
            <button className="btn" onClick={enableAll} disabled={enablingAll || !models.some((model) => !model.enabled)}>
              <CheckCheck size={16} /> {enablingAll ? "Enabling…" : "Enable all"}
            </button>
            <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)} disabled={connections.length === 0}>
              <Plus size={16} /> Register model
            </button>
          </div>
        </div>

        <div className="model-search">
          <Search size={15} />
          <input className="input" placeholder="Search models" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="model-filters">
          {FILTERS.map((f) => (
            <button key={f.value} className={`filter-pill ${filter === f.value ? "active" : ""}`} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
          {connections.length > 1 && (
            <select className="input filter-pill" style={{ padding: "6px 10px" }} value={connectionFilter} onChange={(e) => setConnectionFilter(e.target.value)}>
              <option value="all">All connections</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.connection_name}
                </option>
              ))}
            </select>
          )}
        </div>

        {actionError && <p className="error-text">{actionError}</p>}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-6)" }}>
            <div className="spinner" />
          </div>
        ) : connections.length === 0 ? (
          <div className="empty-state card">
            <Boxes size={28} color="var(--text-tertiary)" />
            <h3>Connect a provider first</h3>
            <p>Models come from your provider connections. Add one in the Provider Manager to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state card">
            <Boxes size={28} color="var(--text-tertiary)" />
            <h3>No models match</h3>
            <p>Try a different filter, refresh discovery from the Provider Manager, or register a model ID manually.</p>
          </div>
        ) : (
          <div className="model-grid">
            {[...filtered].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.display_name.localeCompare(b.display_name)).map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                connectionName={connectionNameById[m.connection_id]}
                onToggle={() => toggleEnabled(m)}
                onRemove={() => removeModel(m)}
                onRename={(name) => renameModel(m, name)}
              />
            ))}
          </div>
        )}
      </div>

      {showRegisterModal && (
        <RegisterModelModal
          connections={connections}
          onClose={() => setShowRegisterModal(false)}
          onRegistered={(model) => {
            setModels((prev) => [model, ...prev]);
            setShowRegisterModal(false);
          }}
        />
      )}
    </div>
  );
}

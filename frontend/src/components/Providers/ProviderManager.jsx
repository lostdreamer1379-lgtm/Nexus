import { useEffect, useState } from "react";
import { Plus, Plug } from "lucide-react";
import { api } from "../../api/client";
import ProviderCard from "./ProviderCard.jsx";
import AddProviderModal from "./AddProviderModal.jsx";
import RegisterModelModal from "../Models/RegisterModelModal.jsx";

export default function ProviderManager() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [discoverySummary, setDiscoverySummary] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.get("/api/v1/providers/connections");
      setConnections(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (connection) => {
    if (
      !window.confirm(
        `Remove "${connection.connection_name}"? This deletes its stored credential and every model registered through it. Your conversations are not affected.`
      )
    )
      return;
    await api.delete(`/api/v1/providers/connections/${connection.id}`);
    setConnections((prev) => prev.filter((c) => c.id !== connection.id));
  };

  const handleTest = async (connection) => {
    const updated = await api.post(`/api/v1/providers/connections/${connection.id}/test`);
    setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleRefreshModels = async (connection) => {
    setActionError(null);
    try {
      const summary = await api.post(`/api/v1/providers/connections/${connection.id}/models/refresh`);
      setDiscoverySummary({
        connectionName: connection.connection_name,
        ...summary,
      });
      await load();
    } catch (err) {
      setActionError(err?.message || "Model capability discovery failed.");
    }
  };

  return (
    <div className="page">
      <style>{`
        .page { height: 100%; overflow-y: auto; padding: var(--space-6) var(--space-5); }
        .page-inner { max-width: 760px; margin: 0 auto; }
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-5); gap: var(--space-3); }
        .page-header h1 { font-size: 20px; margin: 0 0 4px; }
        .page-header p { color: var(--text-secondary); font-size: 14px; margin: 0; }
        .connection-grid { display: flex; flex-direction: column; gap: var(--space-3); }
      `}</style>
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Provider Manager</h1>
            <p>Connect your own API keys. Each connection stays private to your account.</p>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setShowModelModal(true)} disabled={connections.length === 0}>
              Add single model
            </button>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={16} /> Add provider
            </button>
          </div>
        </div>

        {actionError && <p className="error-text">{actionError}</p>}
        {discoverySummary && (
          <div className="card" style={{ marginBottom: "var(--space-4)", borderColor: "var(--accent)" }}>
            <strong>Model verification complete for {discoverySummary.connectionName}</strong>
            <p style={{ margin: "5px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
              {discoverySummary.message}
            </p>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-6)" }}>
            <div className="spinner" />
          </div>
        ) : connections.length === 0 ? (
          <div className="empty-state card">
            <Plug size={28} color="var(--text-tertiary)" />
            <h3>No providers connected yet</h3>
            <p>Add OpenRouter, NVIDIA, OpenAI, Gemini, Anthropic, or your own custom endpoint to start chatting.</p>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={16} /> Add your first provider
            </button>
          </div>
        ) : (
          <div className="connection-grid">
            {connections.map((c) => (
              <ProviderCard
                key={c.id}
                connection={c}
                onDelete={() => handleDelete(c)}
                onTest={() => handleTest(c)}
                onRefreshModels={() => handleRefreshModels(c)}
                onEdit={() => setEditingConnection(c)}
              />
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddProviderModal
          onClose={() => setShowAddModal(false)}
          onCreated={(conn) => {
            setConnections((prev) => [conn, ...prev]);
            setShowAddModal(false);
          }}
        />
      )}

      {editingConnection && (
        <AddProviderModal
          editing={editingConnection}
          onClose={() => setEditingConnection(null)}
          onCreated={(updated) => {
            setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setEditingConnection(null);
          }}
        />
      )}

      {showModelModal && (
        <RegisterModelModal
          connections={connections}
          onClose={() => setShowModelModal(false)}
          onRegistered={() => setShowModelModal(false)}
        />
      )}
    </div>
  );
}

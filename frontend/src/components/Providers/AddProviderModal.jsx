import { useEffect, useRef, useState } from "react";
import { X, Zap } from "lucide-react";
import { api, ApiError } from "../../api/client";

const PROVIDER_OPTIONS = [
  { value: "openrouter", label: "OpenRouter", hint: "Access to a wide range of hosted models, including many free ones." },
  { value: "nvidia", label: "NVIDIA NIM", hint: "NVIDIA-hosted inference (e.g. Nemotron family). Verify current model IDs in NVIDIA's docs." },
  { value: "openai", label: "OpenAI", hint: "GPT and o-series models." },
  { value: "gemini", label: "Google Gemini", hint: "Gemini model family." },
  { value: "anthropic", label: "Anthropic", hint: "Claude model family." },
  { value: "custom", label: "Custom endpoint", hint: "Any OpenAI-compatible API — self-hosted or third-party." },
];

export default function AddProviderModal({ onClose, onCreated, editing }) {
  const [providerType, setProviderType] = useState(editing?.provider_type || "openrouter");
  const [connectionName, setConnectionName] = useState(editing?.connection_name || "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(editing?.base_url || "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Post-save model discovery step
  const [savedConnection, setSavedConnection] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState(null); // null = not attempted yet
  const [selectedIds, setSelectedIds] = useState(new Set());
  const selectAllRef = useRef(null);

  const isCustom = providerType === "custom";

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let conn;
      if (editing) {
        const payload = { connection_name: connectionName };
        if (apiKey) payload.api_key = apiKey;
        if (isCustom && baseUrl) payload.base_url = baseUrl;
        conn = await api.patch(`/api/v1/providers/connections/${editing.id}`, payload);
        onCreated(conn);
        return;
      }

      conn = await api.post("/api/v1/providers/connections", {
        provider_type: providerType,
        connection_name: connectionName || PROVIDER_OPTIONS.find((p) => p.value === providerType)?.label,
        api_key: apiKey,
        base_url: isCustom ? baseUrl : undefined,
      });

      if (conn.connection_status !== "connected") {
        setError(conn.last_error || "Could not validate this connection. Check the key and try again.");
        setSubmitting(false);
        return;
      }

      setSavedConnection(conn);
      setDiscovering(true);
      try {
        const models = await api.post(`/api/v1/providers/connections/${conn.id}/models/refresh`);
        setDiscovered(models);
      } catch {
        setDiscovered([]); // discovery unsupported or failed — user can register manually in Model Library
      } finally {
        setDiscovering(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleModel = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allModelsSelected = discovered?.length > 0 && selectedIds.size === discovered.length;
  const someModelsSelected = selectedIds.size > 0 && !allModelsSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someModelsSelected;
    }
  }, [someModelsSelected]);

  const toggleAllModels = () => {
    setSelectedIds(
      allModelsSelected ? new Set() : new Set(discovered.map((model) => model.id))
    );
  };

  const finishSelection = async () => {
    await Promise.all(
      [...selectedIds].map((id) => api.patch(`/api/v1/models/${id}`, { enabled: true }))
    );
    onCreated(savedConnection);
  };

  // --- Render: model selection step (after a successful new connection) ---
  if (savedConnection) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h2 className="modal-title">Choose models to enable</h2>
          {discovering ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-5)" }}>
              <div className="spinner" />
            </div>
          ) : discovered && discovered.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto", marginBottom: "var(--space-4)" }}>
              {discovered.map((m) => (
                <label key={m.id} className="model-pick-row">
                  <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleModel(m.id)} />
                  <span style={{ flex: 1, fontSize: 13.5 }}>{m.display_name}</span>
                  {m.pricing_tier === "free" && <Zap size={13} color="var(--success)" />}
                </label>
              ))}
              <label className="model-pick-row model-pick-select-all">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allModelsSelected}
                  onChange={toggleAllModels}
                />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>
                  {allModelsSelected ? "Deselect all" : "Select all"}
                </span>
                <span className="model-pick-count">{selectedIds.size} of {discovered.length}</span>
              </label>
              <style>{`
                .model-pick-row { display:flex; align-items:center; gap:8px; padding:7px 4px; border-radius: var(--radius-sm); }
                .model-pick-row:hover { background: var(--bg-2); }
                .model-pick-select-all { border-top: 1px solid var(--border-subtle); margin-top: 4px; padding-top: 10px; }
                .model-pick-count { color: var(--text-tertiary); font-size: 12px; }
              `}</style>
            </div>
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: "var(--space-4)" }}>
              This provider doesn&apos;t support automatic model discovery (or none were returned). You can register a
              specific model ID manually from the Model Library.
            </p>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => onCreated(savedConnection)}>
              Skip for now
            </button>
            <button className="btn btn-primary" onClick={finishSelection} disabled={selectedIds.size === 0}>
              Enable {selectedIds.size || ""} model{selectedIds.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Render: connection form ---
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="modal-title">{editing ? "Edit connection" : "Add a provider"}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit}>
          {!editing && (
            <div className="field">
              <label>Provider</label>
              <select className="input" value={providerType} onChange={(e) => setProviderType(e.target.value)}>
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">{PROVIDER_OPTIONS.find((p) => p.value === providerType)?.hint}</span>
            </div>
          )}

          <div className="field">
            <label>Connection name</label>
            <input
              className="input"
              placeholder="e.g. OpenRouter Free"
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              required={!editing}
            />
            <span className="field-hint">You can add more than one connection to the same provider — name them so you can tell them apart.</span>
          </div>

          {isCustom && (
            <div className="field">
              <label>Base URL</label>
              <input
                className="input"
                placeholder="https://your-endpoint.example.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required={!editing}
              />
              <span className="field-hint">Must be an HTTPS, publicly reachable OpenAI-compatible API — not a local or private address.</span>
            </div>
          )}

          <div className="field">
            <label>API key {editing && "(leave blank to keep the current one)"}</label>
            <input
              className="input"
              type="password"
              placeholder={editing ? "••••••••••••" : "Paste your API key"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required={!editing}
              autoComplete="off"
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <span className="spinner" /> : editing ? "Save changes" : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

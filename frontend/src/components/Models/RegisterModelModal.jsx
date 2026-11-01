import { useState } from "react";
import { X } from "lucide-react";
import { api, ApiError } from "../../api/client";

export default function RegisterModelModal({ connections, onClose, onRegistered }) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id || "");
  const [providerModelId, setProviderModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const model = await api.post("/api/v1/models", {
        connection_id: connectionId,
        provider_model_id: providerModelId.trim(),
        display_name: displayName.trim() || undefined,
      });
      onRegistered(model);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="modal-title">Register a model manually</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label>Connection</label>
            <select className="input" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.connection_name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Model ID</label>
            <input
              className="input"
              placeholder="e.g. nvidia/nemotron-4-340b-instruct"
              value={providerModelId}
              onChange={(e) => setProviderModelId(e.target.value)}
              required
            />
            <span className="field-hint">
              Use the exact ID your provider expects. Check the provider&apos;s current documentation — model IDs
              change over time and this isn&apos;t validated until your first chat message.
            </span>
          </div>

          <div className="field">
            <label>Display name (optional)</label>
            <input
              className="input"
              placeholder="A friendlier name for the model selector"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !connectionId}>
              {submitting ? <span className="spinner" /> : "Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

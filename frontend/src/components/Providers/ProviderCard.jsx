import { useState } from "react";
import { RefreshCw, Pencil, Trash2, SearchCheck } from "lucide-react";
import { Link } from "react-router-dom";

const PROVIDER_LABELS = {
  openrouter: "OpenRouter",
  nvidia: "NVIDIA NIM",
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic",
  custom: "Custom endpoint",
};

const STATUS_META = {
  connected: { label: "Connected", className: "badge-success" },
  unverified: { label: "Unverified", className: "badge-neutral" },
  needs_revalidation: { label: "Needs revalidation", className: "badge-warning" },
  invalid_key: { label: "Invalid key", className: "badge-danger" },
  auth_failed: { label: "Authentication failed", className: "badge-danger" },
  rate_limited: { label: "Rate limited", className: "badge-warning" },
  provider_unavailable: { label: "Provider unavailable", className: "badge-danger" },
};

export default function ProviderCard({ connection, onDelete, onTest, onRefreshModels, onEdit }) {
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const status = STATUS_META[connection.connection_status] || STATUS_META.unverified;

  const runTest = async () => {
    setTesting(true);
    try {
      await onTest();
    } finally {
      setTesting(false);
    }
  };

  const runRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshModels();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="card provider-card">
      <style>{`
        .provider-card { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) var(--space-5); }
        .pc-main { min-width: 0; }
        .pc-name { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
        .pc-type { font-size: 13px; color: var(--text-secondary); margin: 0 0 8px; }
        .pc-error { font-size: 12.5px; color: var(--danger); margin-top: 6px; }
        .pc-actions { display: flex; gap: 6px; flex-shrink: 0; }
      `}</style>
      <div className="pc-main">
        <p className="pc-name">{connection.connection_name}</p>
        <p className="pc-type">
          {PROVIDER_LABELS[connection.provider_type] || connection.provider_type}
          {connection.base_url ? ` · ${new URL(connection.base_url).hostname}` : ""}
        </p>
        <span className={`badge ${status.className}`}>
          <span className="badge-dot" />
          {status.label}
        </span>
        {connection.last_error && <p className="pc-error">{connection.last_error}</p>}
      </div>
      <div className="pc-actions">
        <button className="btn btn-ghost" onClick={runRefresh} title="Rerun model capability discovery" disabled={refreshing}>
          {refreshing ? <span className="spinner" /> : <SearchCheck size={15} />} Discover models
        </button>
        <button className="btn btn-ghost btn-icon" onClick={runTest} title="Test connection" disabled={testing}>
          {testing ? <span className="spinner" /> : <RefreshCw size={15} />}
        </button>
        <Link to="/models" className="btn btn-ghost" style={{ fontSize: 13 }}>
          View models
        </Link>
        <button className="btn btn-ghost btn-icon" onClick={onEdit} title="Edit connection">
          <Pencil size={15} />
        </button>
        <button className="btn btn-ghost btn-icon" onClick={onDelete} title="Remove connection">
          <Trash2 size={15} color="var(--danger)" />
        </button>
      </div>
    </div>
  );
}

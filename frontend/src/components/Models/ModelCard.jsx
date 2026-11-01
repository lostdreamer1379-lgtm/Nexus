import { useState } from "react";
import { Zap, Eye, Wrench, Trash2, Pencil, Check, X } from "lucide-react";

const PRICING_META = {
  free: { label: "Free", className: "badge-success" },
  paid: { label: "Paid", className: "badge-neutral" },
  unknown: { label: "Pricing unknown", className: "badge-neutral" },
};

function formatPrice(value) {
  if (value === null || value === undefined) return null;
  return `$${value.toFixed(2)} / 1M tokens`;
}

export default function ModelCard({ model, connectionName, onToggle, onRemove, onRename }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(model.display_name);
  const pricing = PRICING_META[model.pricing_tier] || PRICING_META.unknown;

  const commitRename = () => {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== model.display_name) onRename(trimmed);
    else setName(model.display_name);
  };

  return (
    <div className="card model-card">
      <style>{`
        .model-card { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) var(--space-5); }
        .mc-main { min-width: 0; flex: 1; }
        .mc-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .mc-name { font-size: 15px; font-weight: 600; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mc-meta { font-size: 12.5px; color: var(--text-tertiary); margin: 0 0 8px; }
        .mc-badges { display: flex; gap: 6px; flex-wrap: wrap; }
        .mc-rename-input { font-size: 15px; font-weight: 600; background: var(--bg-2); border: 1px solid var(--accent); border-radius: 4px; padding: 2px 6px; color: var(--text-primary); }
        .mc-actions { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
        .switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .switch-track {
          position: absolute; inset: 0; background: var(--bg-3); border: 1px solid var(--border); border-radius: 999px;
          cursor: pointer; transition: background-color 0.15s ease;
        }
        .switch-track::before {
          content: ""; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px;
          background: var(--text-secondary); border-radius: 50%; transition: transform 0.15s ease, background-color 0.15s ease;
        }
        .switch input:checked + .switch-track { background: var(--accent-dim); border-color: var(--accent); }
        .switch input:checked + .switch-track::before { transform: translateX(16px); background: var(--accent); }
      `}</style>

      <div className="mc-main">
        <div className="mc-name-row">
          {editing ? (
            <>
              <input
                className="mc-rename-input"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitRename()}
              />
              <button className="btn btn-ghost btn-icon" onClick={commitRename}>
                <Check size={14} />
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => { setEditing(false); setName(model.display_name); }}>
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <p className="mc-name">{model.display_name}</p>
              <button className="btn btn-ghost btn-icon" onClick={() => setEditing(true)} title="Rename" style={{ padding: 4 }}>
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
        <p className="mc-meta">
          {connectionName} · {model.provider_model_id}
          {model.context_length ? ` · ${model.context_length.toLocaleString()} ctx` : ""}
        </p>
        <div className="mc-badges">
          <span className={`badge ${pricing.className}`}>
            {model.pricing_tier === "free" && <Zap size={11} />}
            {pricing.label}
          </span>
          {model.pricing_tier === "paid" && (formatPrice(model.input_price_per_million) || formatPrice(model.output_price_per_million)) && (
            <span className="badge badge-neutral">
              {formatPrice(model.input_price_per_million) || formatPrice(model.output_price_per_million)}
            </span>
          )}
          {model.supports_vision && (
            <span className="badge badge-neutral">
              <Eye size={11} /> Vision
            </span>
          )}
          {model.supports_tools && (
            <span className="badge badge-neutral">
              <Wrench size={11} /> Tools
            </span>
          )}
        </div>
      </div>

      <div className="mc-actions">
        <label className="switch" title={model.enabled ? "Disable" : "Enable"}>
          <input type="checkbox" checked={model.enabled} onChange={onToggle} />
          <span className="switch-track" />
        </label>
        <button className="btn btn-ghost btn-icon" onClick={onRemove} title="Remove from library">
          <Trash2 size={15} color="var(--danger)" />
        </button>
      </div>
    </div>
  );
}

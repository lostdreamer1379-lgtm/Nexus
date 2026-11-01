import { Database, Trash2 } from "lucide-react";

export default function KBCard({ kb, active, onClick, onDelete }) {
  return (
    <div
      className={`card kb-card ${active ? "kb-card-active" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <style>{`
        .kb-card {
          cursor: pointer; padding: var(--space-4);
          transition: border-color 0.12s, background 0.12s;
        }
        .kb-card:hover { border-color: var(--border-strong); background: var(--bg-2); }
        .kb-card-active { border-color: var(--accent) !important; background: color-mix(in srgb, var(--accent-dim) 60%, var(--bg-1)); }
        .kb-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .kb-card-name { font-size: 14px; font-weight: 600; margin: 0 0 4px; display: flex; align-items: center; gap: 6px; }
        .kb-card-desc { font-size: 13px; color: var(--text-secondary); margin: 0 0 10px; }
        .kb-card-meta { display: flex; gap: 8px; flex-wrap: wrap; }
        .kb-del-btn {
          background: none; border: none; cursor: pointer; color: var(--text-tertiary);
          padding: 2px; border-radius: 4px; flex-shrink: 0;
        }
        .kb-del-btn:hover { color: var(--danger); }
      `}</style>

      <div className="kb-card-header">
        <div style={{ minWidth: 0 }}>
          <p className="kb-card-name">
            <Database size={13} color="var(--accent)" />
            {kb.name}
          </p>
          {kb.description && <p className="kb-card-desc">{kb.description}</p>}
        </div>
        <button
          className="kb-del-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete knowledge base"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="kb-card-meta">
        <span className="badge badge-neutral">
          {kb.document_count} doc{kb.document_count !== 1 ? "s" : ""}
        </span>
        <span className="badge badge-neutral">
          top-{kb.retrieval_k} chunks
        </span>
        {kb.embedding_dim && (
          <span className="badge badge-neutral">{kb.embedding_dim}d embeddings</span>
        )}
      </div>
    </div>
  );
}

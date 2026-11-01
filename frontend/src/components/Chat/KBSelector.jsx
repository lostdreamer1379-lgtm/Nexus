import { useEffect, useRef, useState } from "react";
import { Database, ChevronDown, Check, X } from "lucide-react";

export default function KBSelector({ knowledgeBases, selectedKbId, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = knowledgeBases.find((k) => k.id === selectedKbId);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="kb-selector" ref={ref}>
      <style>{`
        .kb-selector { position: relative; }
        .kb-trigger {
          display: flex; align-items: center; gap: 6px;
          font-size: 13px; font-weight: 500;
          padding: 6px 10px; border-radius: var(--radius-md);
          border: 1px solid var(--border); background: var(--bg-2);
          color: var(--text-secondary); cursor: pointer;
          transition: border-color 0.12s, color 0.12s;
        }
        .kb-trigger:hover { border-color: var(--border-strong); color: var(--text-primary); }
        .kb-trigger.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
        .kb-menu {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 50;
          width: 260px; max-height: 300px; overflow-y: auto;
          background: var(--bg-2); border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 6px;
          box-shadow: 0 12px 32px rgba(0,0,0,0.35);
        }
        .kb-item {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; padding: 9px 10px; border-radius: var(--radius-sm);
          cursor: pointer; font-size: 13.5px;
        }
        .kb-item:hover { background: var(--bg-3); }
        .kb-item-info { min-width: 0; }
        .kb-item-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kb-item-meta { font-size: 11.5px; color: var(--text-tertiary); margin-top: 1px; }
        .kb-none { padding: 9px 10px; font-size: 13.5px; color: var(--text-tertiary); }
        .kb-divider { border: none; border-top: 1px solid var(--border-subtle); margin: 4px 0; }
      `}</style>

      <button
        className={`kb-trigger ${selected ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={selected ? `Knowledge base: ${selected.name}` : "Add knowledge base context"}
      >
        <Database size={14} />
        {selected ? selected.name : "No KB"}
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="kb-menu">
          {/* "None" option to deactivate RAG */}
          <div
            className="kb-item"
            onClick={() => { onSelect(null); setOpen(false); }}
          >
            <div className="kb-item-info">
              <div className="kb-item-name">No knowledge base</div>
              <div className="kb-item-meta">Plain conversation, no document context</div>
            </div>
            {!selectedKbId && <Check size={14} color="var(--accent)" />}
          </div>

          {knowledgeBases.length > 0 && <hr className="kb-divider" />}

          {knowledgeBases.map((kb) => (
            <div
              key={kb.id}
              className="kb-item"
              onClick={() => { onSelect(kb.id); setOpen(false); }}
            >
              <div className="kb-item-info">
                <div className="kb-item-name">{kb.name}</div>
                <div className="kb-item-meta">
                  {kb.document_count} doc{kb.document_count !== 1 ? "s" : ""}
                  {kb.description ? ` · ${kb.description}` : ""}
                </div>
              </div>
              {kb.id === selectedKbId && <Check size={14} color="var(--accent)" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Zap } from "lucide-react";
import { Link } from "react-router-dom";

export default function ModelSelector({ models, selectedModelId, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = models.find((m) => m.id === selectedModelId);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (models.length === 0) {
    return (
      <Link to="/models" className="btn btn-ghost" style={{ fontSize: 13.5 }}>
        No models enabled — open Model Library
      </Link>
    );
  }

  return (
    <div className="model-selector" ref={ref}>
      <style>{`
        .model-selector { position: relative; }
        .ms-trigger {
          display: flex; align-items: center; gap: 6px;
          font-size: 14px; font-weight: 600; color: var(--text-primary);
          background: transparent; border: none; cursor: pointer; padding: 6px 8px; border-radius: var(--radius-sm);
        }
        .ms-trigger:hover { background: var(--bg-2); }
        .ms-menu {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 50;
          width: 300px; max-height: 360px; overflow-y: auto;
          background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md);
          padding: 6px; box-shadow: 0 12px 32px rgba(0,0,0,0.35);
        }
        .ms-item {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 9px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13.5px;
        }
        .ms-item:hover { background: var(--bg-3); }
        .ms-item-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .ms-item-name strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ms-item-meta { font-size: 11.5px; color: var(--text-tertiary); }
      `}</style>

      <button className="ms-trigger" onClick={() => setOpen((v) => !v)}>
        {selected?.pricing_tier === "free" && <Zap size={14} color="var(--success)" />}
        {selected?.display_name || "Select a model"}
        <ChevronDown size={15} />
      </button>

      {open && (
        <div className="ms-menu">
          {models.map((m) => (
            <div
              key={m.id}
              className="ms-item"
              onClick={() => {
                onSelect(m.id);
                setOpen(false);
              }}
            >
              <div className="ms-item-name">
                <strong>{m.display_name}</strong>
                <span className="ms-item-meta">
                  {m.pricing_tier === "free" ? "Free" : m.pricing_tier === "paid" ? "Paid" : "Pricing unknown"}
                </span>
              </div>
              {m.id === selectedModelId && <Check size={15} color="var(--accent)" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

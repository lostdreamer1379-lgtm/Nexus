import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";

export default function ModelSelector({ models, selectedModelId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selected = models.find((m) => m.id === selectedModelId);

  useEffect(() => {
    const onClick = (e) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const positionMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mobile = window.innerWidth <= 860;
    setMenuStyle(mobile
      ? {
          position: "fixed",
          top: `${Math.min(rect.bottom + 8, window.innerHeight - 380)}px`,
          left: "12px",
          right: "12px",
          width: "auto",
        }
      : {
          position: "fixed",
          top: `${rect.bottom + 6}px`,
          left: `${rect.left}px`,
          width: "300px",
        });
  };

  const toggleMenu = () => {
    if (!open) positionMenu();
    setOpen((value) => !value);
  };

  if (models.length === 0) {
    return (
      <Link to="/models" className="btn btn-ghost" style={{ fontSize: 13.5 }}>
        No models enabled — open Model Library
      </Link>
    );
  }

  return (
    <div className="model-selector">
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
          padding: 6px;           box-shadow: 0 18px 45px rgba(0,0,0,0.42);
          animation: menu-in .16s ease-out;
        }
        @media (max-width: 860px) {
          .ms-menu {
            position: fixed; top: 104px; bottom: auto; left: 12px; right: 12px; width: auto;
            max-height: min(360px, calc(100dvh - 120px)); z-index: 300;
          }
        }
        .ms-item {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          min-height: 44px; padding: 9px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13.5px;
        }
        .ms-item:hover { background: var(--bg-3); }
        .ms-item-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .ms-item-name strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ms-item-meta { font-size: 11.5px; color: var(--text-tertiary); }
        @keyframes menu-in { from { opacity: 0; transform: translateY(-5px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>

      <button ref={triggerRef} type="button" className="ms-trigger" onClick={toggleMenu}>
        {selected?.pricing_tier === "free" && <Zap size={14} color="var(--success)" />}
        {selected?.display_name || "Select a model"}
        <ChevronDown size={15} />
      </button>

      {open && createPortal(
        <div ref={menuRef} className="ms-menu" style={menuStyle}>
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
        </div>,
        document.body
      )}
    </div>
  );
}

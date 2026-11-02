import { useRef, useState } from "react";
import { ArrowUp, ChevronDown, Plus, Square, X } from "lucide-react";

export default function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  webSearch,
  allSources,
  responseMode,
  onResponseModeChange,
  agentWorkflow,
  onToggleWeb,
  onToggleAllSources,
  onToggleAgent,
}) {
  const [text, setText] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [responseModeOpen, setResponseModeOpen] = useState(false);
  const textareaRef = useRef(null);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming || disabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const responseModes = [
    ["chat", "Normal chat"],
    ["zip", "Download ZIP"],
    ["photo", "Photo / image"],
    ["video", "Video"],
  ];
  const selectedModeLabel = responseModes.find(([value]) => value === responseMode)?.[1] || "Normal chat";

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = (e) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  return (
    <div className="composer">
      <style>{`
        .composer {
          padding: var(--space-4) var(--space-5);
          padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
          z-index: 100;
          background: var(--bg-1);
        }
        .composer-inner {
          max-width: 760px; margin: 0 auto;
          display: flex; flex-direction:column; gap: var(--space-2);
          background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-lg);
          padding: 8px;
        }
        .composer-inner:focus-within { border-color: var(--accent); }
        .composer-input-row { width:100%; display:flex; align-items:flex-end; gap:var(--space-2); padding-left:8px; }
        .composer textarea {
          flex: 1; resize: none; border: none; background: transparent; color: var(--text-primary);
          font-family: inherit; font-size: 14.5px; line-height: 1.5; max-height: 200px; padding: 8px 0;
          outline: none;
        }
        .composer textarea::placeholder { color: var(--text-tertiary); }
        .composer-tools { width:100%; display:flex; align-items:center; gap:8px; }
        .composer-sources { position:relative; flex-shrink:0; }
        .composer-sources-trigger {
          display:flex; align-items:center; gap:6px; min-height:34px; max-width:100%;
          padding:6px 10px; border:1px solid var(--border); border-radius:999px;
          background:var(--bg-1); color:var(--text-secondary); cursor:pointer; font-size:12px;
          overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
        }
        .composer-sources-trigger:hover, .composer-sources-trigger.active { border-color:var(--accent); color:var(--text-primary); }
        .composer-sources-trigger.typing { width:34px; padding:6px; justify-content:center; }
        .composer-sources-label { overflow:hidden; text-overflow:ellipsis; }
        .composer-sources-menu {
          position:absolute; right:0; bottom:calc(100% + 8px); z-index:220; width:190px;
          padding:6px; border:1px solid var(--border); border-radius:var(--radius-md);
          background:var(--bg-2); box-shadow:0 18px 45px rgba(0,0,0,.42);
          animation:menu-in .16s ease-out;
        }
        .composer-source-option {
          width:100%; display:flex; align-items:center; justify-content:space-between;
          min-height:38px; padding:7px 9px; border:0; border-radius:var(--radius-sm);
          background:transparent; color:var(--text-secondary); cursor:pointer; text-align:left; font-size:12.5px;
        }
        .composer-source-option:hover, .composer-source-option.selected { background:var(--accent-dim); color:var(--text-primary); }
        .composer-mode { position:relative; flex-shrink:0; }
        .composer-mode-trigger {
          display:flex; align-items:center; gap:5px; min-height:34px; max-width:170px;
          padding:6px 10px; border:1px solid var(--border); border-radius:999px;
          background:var(--bg-1); color:var(--text-secondary); cursor:pointer; font-size:12px;
        }
        .composer-mode-trigger:hover, .composer-mode-trigger.active { border-color:var(--accent); color:var(--text-primary); }
        .composer-mode-menu {
          position:absolute; left:0; bottom:calc(100% + 8px); z-index:220; width:190px;
          padding:6px; border:1px solid var(--border); border-radius:var(--radius-md);
          background:var(--bg-2); box-shadow:0 18px 45px rgba(0,0,0,.42);
          animation:menu-in .16s ease-out;
        }
        .composer-mode-option {
          width:100%; display:flex; align-items:center; justify-content:space-between;
          min-height:38px; padding:7px 9px; border:0; border-radius:var(--radius-sm);
          background:transparent; color:var(--text-secondary); cursor:pointer; text-align:left; font-size:12.5px;
        }
        .composer-mode-option:hover, .composer-mode-option.selected { background:var(--accent-dim); color:var(--text-primary); }
        @keyframes menu-in { from { opacity:0; transform:translateY(5px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        @media (max-width:600px) {
          .composer-mode { flex:1; min-width:0; }
          .composer-mode-trigger { max-width:none; width:100%; justify-content:space-between; }
          .composer-mode-menu { left:0; right:0; width:auto; min-width:180px; }
          .composer-sources { min-width:0; }
          .composer-sources-trigger { max-width:128px; }
          .composer-sources-menu { width:min(220px, calc(100vw - 24px)); }
        }
        .composer-model { min-width:0; max-width:100%; }
        .composer-model .model-selector { max-width:100%; }
        .composer-model .ms-trigger { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
        @media (max-width:600px) {
          .composer { padding-left:12px; padding-right:12px; }
          .composer-input-row { padding-left:4px; }
        }
        .composer-send {
          display: flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border-radius: var(--radius-md); border: none; cursor: pointer;
          background: var(--accent); color: var(--accent-text-on); flex-shrink: 0;
          transition: transform .12s ease, background-color .18s ease, box-shadow .18s ease;
          box-shadow: 0 5px 16px color-mix(in srgb, var(--accent) 22%, transparent);
        }
        .composer-send:not(:disabled):active { transform: scale(.92); }
        .composer-send:not(:disabled):hover { background: var(--accent-hover); }
        .composer-send:disabled { background: var(--bg-3); color: var(--text-tertiary); cursor: not-allowed; }
        .composer-hint { text-align: center; font-size: 11.5px; color: var(--text-tertiary); margin-top: 8px; }
      `}</style>
      <div className="composer-inner">
        <div className="composer-input-row">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={disabled ? "Enable a model to start chatting" : "Message Nexus AI..."}
            value={text}
            onChange={autoGrow}
            onKeyDown={onKeyDown}
            disabled={disabled}
          />
          {streaming ? (
            <button className="composer-send" onClick={onStop} aria-label="Stop generating">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="composer-send" onClick={submit} disabled={!text.trim() || disabled} aria-label="Send message">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <div className="composer-tools">
          <div className="composer-mode">
            <button
              type="button"
              className={`composer-mode-trigger ${responseModeOpen ? "active" : ""}`}
              onClick={() => {
                setSourcesOpen(false);
                setResponseModeOpen((value) => !value);
              }}
              aria-expanded={responseModeOpen}
            >
              {selectedModeLabel}<ChevronDown size={13} />
            </button>
            {responseModeOpen && (
              <div className="composer-mode-menu">
                {responseModes.map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={`composer-mode-option ${responseMode === value ? "selected" : ""}`}
                    onClick={() => {
                      onResponseModeChange(value);
                      setResponseModeOpen(false);
                    }}
                  >
                    <span>{label}</span>
                    {responseMode === value && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-sources">
            <button
              type="button"
              className={`composer-sources-trigger ${sourcesOpen ? "active" : ""} ${text.trim() && !sourcesOpen ? "typing" : ""}`}
              onClick={() => {
                setResponseModeOpen(false);
                setSourcesOpen((value) => !value);
              }}
              aria-expanded={sourcesOpen}
              aria-label={sourcesOpen ? "Close source selector" : "Open source selector"}
            >
              {text.trim() && !sourcesOpen ? <Plus size={18} /> : sourcesOpen ? <X size={15} /> : (
                <>
                  <span className="composer-sources-label">
                    {webSearch || allSources || agentWorkflow
                      ? [allSources && "All sources", !allSources && webSearch && "Web", agentWorkflow && "Agent"].filter(Boolean).join(" · ")
                      : "Sources"}
                  </span>
                  <ChevronDown size={14} />
                </>
              )}
            </button>
            {sourcesOpen && (
              <div className="composer-sources-menu">
                <button type="button" className={`composer-source-option ${allSources ? "selected" : ""}`} onClick={() => { onToggleAllSources(); setSourcesOpen(false); }} aria-pressed={allSources} title="Use memory, the selected knowledge base, and live web search together">
                  <span>All sources</span>{allSources && <span>✓</span>}
                </button>
                <button type="button" className={`composer-source-option ${webSearch && !allSources ? "selected" : ""}`} onClick={() => { onToggleWeb(); setSourcesOpen(false); }} aria-pressed={webSearch && !allSources}>
                  <span>Web</span>{webSearch && !allSources && <span>✓</span>}
                </button>
                <button type="button" className={`composer-source-option ${agentWorkflow ? "selected" : ""}`} onClick={() => { onToggleAgent(); setSourcesOpen(false); }} aria-pressed={agentWorkflow}>
                  <span>Agent</span>{agentWorkflow && <span>✓</span>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="composer-hint">Press Enter to send, or Shift + Enter for a new line</div>
    </div>
  );
}

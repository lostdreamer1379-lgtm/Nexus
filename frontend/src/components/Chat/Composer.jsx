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
  const [optionsOpen, setOptionsOpen] = useState(false);
  const textareaRef = useRef(null);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming || disabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

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
        .composer-options-trigger {
          display:flex; align-items:center; gap:6px; min-height:34px; max-width:100%;
          padding:6px 10px; border:1px solid var(--border); border-radius:999px;
          background:var(--bg-1); color:var(--text-secondary); cursor:pointer; font-size:12px;
          overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
        }
        .composer-options-trigger:hover, .composer-options-trigger.active { border-color:var(--accent); color:var(--text-primary); }
        .composer-options-trigger.typing { width:34px; padding:6px; justify-content:center; }
        .composer-options-label { overflow:hidden; text-overflow:ellipsis; }
        .composer-options { width:100%; display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:4px 0 2px; }
        .composer-option { min-height:34px; padding:6px 10px; border:1px solid var(--border); border-radius:999px; background:var(--bg-1); color:var(--text-secondary); cursor:pointer; font-size:12px; }
        .composer-option.active { border-color:var(--accent); background:var(--accent-dim); color:var(--accent); }
        .composer-mode-select {
          min-height:34px; max-width:170px; min-width:0; padding:6px 26px 6px 10px;
          border:1px solid var(--border); border-radius:999px; background:var(--bg-1);
          color:var(--text-secondary); font-size:12px;
        }
        .composer-model { min-width:0; max-width:100%; }
        .composer-model .model-selector { max-width:100%; }
        .composer-model .ms-trigger { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
        @media (max-width:600px) {
          .composer { padding-left:12px; padding-right:12px; }
          .composer-input-row { padding-left:4px; }
          .composer-options { align-items:stretch; }
          .composer-option { flex:1; }
          .composer-mode-select { flex:1; max-width:none; }
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
          <select
            className="composer-mode-select"
            value={responseMode}
            onChange={(event) => onResponseModeChange(event.target.value)}
            aria-label="Response format"
          >
            <option value="chat">Normal chat</option>
            <option value="zip">Download ZIP</option>
            <option value="photo">Photo / image</option>
            <option value="video">Video</option>
          </select>
          <button
            type="button"
            className={`composer-options-trigger ${optionsOpen ? "active" : ""} ${text.trim() && !optionsOpen ? "typing" : ""}`}
            onClick={() => setOptionsOpen((value) => !value)}
            aria-expanded={optionsOpen}
            aria-label={optionsOpen ? "Close chat options" : "Open chat options"}
          >
            {text.trim() && !optionsOpen ? <Plus size={18} /> : optionsOpen ? <X size={15} /> : (
              <>
                <span className="composer-options-label">
                  {webSearch || allSources || agentWorkflow
                    ? [allSources && "All sources", !allSources && webSearch && "Web", agentWorkflow && "Agent"].filter(Boolean).join(" · ")
                    : "Options"}
                </span>
                <ChevronDown size={14} />
              </>
            )}
          </button>
          {optionsOpen && (
            <div className="composer-options">
              <button type="button" className={`composer-option ${allSources ? "active" : ""}`} onClick={onToggleAllSources} aria-pressed={allSources} title="Use memory, the selected knowledge base, and live web search together">
                All sources
              </button>
              <button type="button" className={`composer-option ${webSearch && !allSources ? "active" : ""}`} onClick={onToggleWeb} aria-pressed={webSearch && !allSources}>
                Web
              </button>
              <button type="button" className={`composer-option ${agentWorkflow ? "active" : ""}`} onClick={onToggleAgent} aria-pressed={agentWorkflow}>
                Agent
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="composer-hint">Press Enter to send, or Shift + Enter for a new line</div>
    </div>
  );
}

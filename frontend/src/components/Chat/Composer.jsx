import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

export default function Composer({ onSend, onStop, streaming, disabled }) {
  const [text, setText] = useState("");
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
          display: flex; align-items: flex-end; gap: var(--space-2);
          background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-lg);
          padding: 8px 8px 8px 16px;
        }
        .composer-inner:focus-within { border-color: var(--accent); }
        .composer textarea {
          flex: 1; resize: none; border: none; background: transparent; color: var(--text-primary);
          font-family: inherit; font-size: 14.5px; line-height: 1.5; max-height: 200px; padding: 8px 0;
          outline: none;
        }
        .composer textarea::placeholder { color: var(--text-tertiary); }
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
      <div className="composer-hint">Press Enter to send, or Shift + Enter for a new line</div>
    </div>
  );
}

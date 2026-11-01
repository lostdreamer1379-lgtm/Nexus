import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, RotateCcw, AlertTriangle, BookOpen, ChevronDown, ChevronUp } from "lucide-react";

function copyableResponse(text) {
  const lines = text.split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    const next = lines[index + 1]?.trim() || "";
    if (line.includes("|") && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(next)) {
      const parseRow = (value) =>
        value
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim().replace(/\s+/g, " "));
      output.push(parseRow(line).join("\t"));
      index += 2;
      while (index < lines.length && lines[index].trim().includes("|")) {
        output.push(parseRow(lines[index].trim()).join("\t"));
        index += 1;
      }
      continue;
    }
    output.push(lines[index]);
    index += 1;
  }
  return output.join("\n");
}

function repairMarkdownTables(text) {
  if (!text || !text.includes("|")) return text;

  let repaired = text.replace(/\r\n/g, "\n");
  // Some models collapse the header, separator, and first row into one line.
  repaired = repaired.replace(
    /\s+\|\s*\|\s*((?::?-{3,}:?\s*\|)+)\s*/g,
    "\n|$1\n"
  );

  const lines = repaired.split("\n");
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1] || "";
    if (current.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next)) {
      const columns = current.replace(/^\|/, "").replace(/\|$/, "").split("|").length;
      const separator = `|${Array.from({ length: columns }, () => "---").join("|")}|`;
      output.push(current, separator);
      index += 1;
      continue;
    }
    output.push(current);
  }
  return output.join("\n");
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-action"
      onClick={async () => {
        await navigator.clipboard.writeText(copyableResponse(text));
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      aria-label="Copy response"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function RagCitations({ chunks }) {
  const [expanded, setExpanded] = useState(false);
  if (!chunks || chunks.length === 0) return null;

  return (
    <div className="rag-citations">
      <button className="rag-toggle" onClick={() => setExpanded((v) => !v)}>
        <BookOpen size={12} />
        {chunks.length} source{chunks.length !== 1 ? "s" : ""} retrieved
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="rag-chunks">
          {chunks.map((c, i) => (
            <div key={i} className="rag-chunk">
              <div className="rag-chunk-header">
                <span className="rag-chunk-file">{c.filename}</span>
                <span className="rag-chunk-score">{(c.score * 100).toFixed(0)}% match</span>
              </div>
              <p className="rag-chunk-content">{c.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebSources({ sources }) {
  if (!sources?.length) return null;
  return (
    <div className="rag-citations">
      <div className="rag-toggle">Live web sources</div>
      <div className="rag-chunks">
        {sources.map((source) => (
          <a
            key={source.url}
            className="rag-chunk"
            href={source.url}
            target="_blank"
            rel="noreferrer"
            style={{ display: "block", textDecoration: "none" }}
          >
            <span className="rag-chunk-file">{source.title}</span>
            <span className="rag-chunk-content">{source.url}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function MessageList({ messages, streaming, onRegenerate }) {
  const bottomRef = useRef(null);
  const previousMessageCount = useRef(messages.length);

  useEffect(() => {
    const container = bottomRef.current?.parentElement?.parentElement;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const messageWasAdded = messages.length > previousMessageCount.current;
    const keyboardIsOpen = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    previousMessageCount.current = messages.length;

    // Streaming updates arrive frequently. Only follow the response when the
    // user is already at the bottom, and never steal the mobile keyboard focus.
    if (distanceFromBottom <= 120 && (!keyboardIsOpen || messageWasAdded)) {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    }
  }, [messages, streaming]);

  const lastAssistantIndex = [...messages].map((m) => m.role).lastIndexOf("assistant");

  return (
    <div className="msg-list">
      <style>{`
        .msg-list {
          max-width: 760px; margin: 0 auto;
          padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-5);
        }
        .msg-row { display: flex; flex-direction: column; gap: 6px; }
        .msg-role { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
        .msg-bubble {
          font-size: 14.5px; line-height: 1.65; color: var(--text-primary);
          padding: var(--space-3) var(--space-4); border-radius: var(--radius-md);
        }
        .msg-row.user .msg-bubble { background: var(--bg-2); align-self: flex-end; max-width: 80%; }
        .msg-row.user { align-items: flex-end; }
        .msg-row.assistant .msg-bubble { padding-left: 0; padding-right: 0; }
        .msg-bubble p { margin: 0 0 0.75em; }
        .msg-bubble p:last-child { margin-bottom: 0; }
        .msg-bubble pre {
          background: var(--bg-2); border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm); padding: var(--space-3);
          overflow-x: auto; font-size: 13px;
        }
        .msg-bubble code { font-family: var(--font-mono); }
        .msg-bubble :not(pre) > code {
          background: var(--bg-2); padding: 2px 5px; border-radius: 4px; font-size: 0.9em;
        }
        .msg-bubble ul, .msg-bubble ol { padding-left: 1.3em; }
        .table-scroll { overflow-x: auto; margin: 12px 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
        .msg-bubble table { border-collapse: collapse; min-width: 100%; font-size: 13px; }
        .msg-bubble th, .msg-bubble td { border-bottom: 1px solid var(--border-subtle); padding: 8px 10px; text-align: left; white-space: nowrap; }
        .msg-bubble th { background: var(--bg-2); color: var(--text-primary); font-weight: 600; }
        .msg-bubble tr:last-child td { border-bottom: none; }
        .msg-actions { display: flex; gap: var(--space-3); margin-top: 2px; }
        .msg-action {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: none; color: var(--text-tertiary);
          font-size: 12px; cursor: pointer; padding: 2px 0;
        }
        .msg-action:hover { color: var(--text-primary); }
        .msg-error {
          display: flex; align-items: center; gap: 6px; color: var(--danger);
          font-size: 13px; background: var(--danger-dim);
          border-radius: var(--radius-sm); padding: 8px 10px;
        }
        .typing-dots { display: inline-flex; gap: 3px; padding: 4px 0; }
        .typing-dots span {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--text-tertiary); animation: blink 1.2s infinite;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

        /* RAG citations */
        .rag-citations { margin-top: 6px; }
        .rag-toggle {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 12px; color: var(--text-tertiary); background: none; border: none;
          cursor: pointer; padding: 3px 0;
        }
        .rag-toggle:hover { color: var(--accent); }
        .rag-chunks {
          margin-top: 8px; display: flex; flex-direction: column; gap: 8px;
        }
        .rag-chunk {
          background: var(--bg-2); border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm); padding: 10px 12px;
        }
        .rag-chunk-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 6px; gap: 8px;
        }
        .rag-chunk-file {
          font-size: 12px; font-weight: 500; color: var(--accent);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rag-chunk-score {
          font-size: 11px; color: var(--text-tertiary); flex-shrink: 0;
        }
        .rag-chunk-content {
          font-size: 12.5px; color: var(--text-secondary); margin: 0;
          line-height: 1.5; display: -webkit-box;
          -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
        }
      `}</style>

      {messages.map((m, i) => (
        <div key={m.id} className={`msg-row ${m.role}`}>
          {m.role === "assistant" && (
            <span className="msg-role">{m.model_display_name || "Assistant"}</span>
          )}
          <div className="msg-bubble">
            {m.role === "assistant" && m.content === "" && streaming && i === messages.length - 1 ? (
              <span className="typing-dots">
                <span /><span /><span />
              </span>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
                }}
              >
                {repairMarkdownTables(m.content)}
              </ReactMarkdown>
            )}
          </div>
          {m.error && (
            <div className="msg-error">
              <AlertTriangle size={14} />
              {m.error}
            </div>
          )}
          {m.role === "assistant" && m.rag_chunks?.length > 0 && (
            <RagCitations chunks={m.rag_chunks} />
          )}
          {m.role === "assistant" && m.web_sources?.length > 0 && (
            <WebSources sources={m.web_sources} />
          )}
          {m.role === "assistant" && m.content && !streaming && (
            <div className="msg-actions">
              <CopyButton text={m.content} />
              {i === lastAssistantIndex && (
                <button className="msg-action" onClick={onRegenerate}>
                  <RotateCcw size={13} /> Regenerate
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

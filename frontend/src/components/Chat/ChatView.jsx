import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api, streamChatCompletion, ApiError, API_BASE_URL } from "../../api/client";
import ModelSelector from "./ModelSelector.jsx";
import KBSelector from "./KBSelector.jsx";
import Composer from "./Composer.jsx";
import { estimateMessageTokens, formatTokenCount } from "../../utils/tokens.js";
import { emitSystemEvent } from "../../utils/systemEvents.js";
import {
  isConversationActive,
  markConversationActive,
  markConversationComplete,
} from "../../utils/backgroundTasks.js";

const MessageList = lazy(() => import("./MessageList.jsx"));

const CHAT_PREFERENCES_KEY = "nexus-chat-preferences";
const LIVE_WEB_CUES = /\b(latest|recent|current|today|tonight|breaking|news|live|real[\s-]?time|search the web|look online|on the internet|according to the web)\b/i;

function readChatPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_PREFERENCES_KEY) || "{}");
    return {
      modelId: typeof saved.modelId === "string" ? saved.modelId : null,
      webSearch: Boolean(saved.webSearch),
      allSources: Boolean(saved.allSources),
      agentWorkflow: Boolean(saved.agentWorkflow),
    };
  } catch {
    return { modelId: null, webSearch: false, allSources: false, agentWorkflow: false };
  }
}

export default function ChatView({ onConversationChange }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const initialPreferences = useRef(readChatPreferences());

  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(initialPreferences.current.modelId);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [selectedKbId, setSelectedKbId] = useState(null);
  const [webSearch, setWebSearch] = useState(initialPreferences.current.webSearch);
  const [allSources, setAllSources] = useState(initialPreferences.current.allSources);
  const [agentWorkflow, setAgentWorkflow] = useState(initialPreferences.current.agentWorkflow);
  const [responseMode, setResponseMode] = useState("chat");
  const [workflowStatus, setWorkflowStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConvo, setLoadingConvo] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [memorySuggestions, setMemorySuggestions] = useState([]);
  const [savingMemory, setSavingMemory] = useState(null);
  const [savedMemoryIds, setSavedMemoryIds] = useState(() => new Set());
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const abortRef = useRef(null);
  const activeConversationIdRef = useRef(conversationId);
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const modeModels = responseMode === "chat" || responseMode === "zip"
    ? models
    : models.filter((model) => {
      const id = `${model.provider_model_id} ${model.display_name}`.toLowerCase();
      return model.supports_vision && /(image|photo|picture|video|vision|dall|flux|stable)/.test(id);
    });
  const usedTokens = estimateMessageTokens(messages);
  const contextLength = selectedModel?.context_length;
  const remainingTokens = contextLength ? Math.max(0, contextLength - usedTokens) : null;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexus-response-modes") || "{}");
      setResponseMode(saved[conversationId || "new"] || "chat");
    } catch {
      setResponseMode("chat");
    }
  }, [conversationId]);

  const selectResponseMode = (mode) => {
    setResponseMode(mode);
    try {
      const saved = JSON.parse(localStorage.getItem("nexus-response-modes") || "{}");
      saved[conversationId || "new"] = mode;
      localStorage.setItem("nexus-response-modes", JSON.stringify(saved));
    } catch {
      // Response mode is a convenience preference.
    }
  };

  const toggleWebSearch = () => setWebSearch((value) => !value);
  const toggleAllSources = () => setAllSources((value) => !value);
  const toggleAgentWorkflow = () => setAgentWorkflow((value) => !value);

  useEffect(() => {
    if (modeModels.length && !modeModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(modeModels[0].id);
    }
  }, [responseMode, modeModels, selectedModelId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_PREFERENCES_KEY,
        JSON.stringify({ modelId: selectedModelId, webSearch, allSources, agentWorkflow })
      );
    } catch {
      // Preferences are optional; chat behavior must continue if storage is unavailable.
    }
  }, [selectedModelId, webSearch, allSources, agentWorkflow]);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
    setSavedMemoryIds(new Set());
  }, [conversationId]);

  // Load enabled models once
  useEffect(() => {
    api
      .get("/api/v1/models?enabled_only=true")
      .then((list) => {
        setModels(list);
        setSelectedModelId((prev) => {
          if (prev && list.some((model) => model.id === prev)) return prev;
          return list[0]?.id || null;
        });
      })
      .catch(() => {});
  }, []);

  // Load knowledge bases once
  useEffect(() => {
    api
      .get("/api/v1/rag/knowledge-bases")
      .then(setKnowledgeBases)
      .catch(() => {});
  }, []);

  // Load conversation history
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setLoadingConvo(true);
    api
      .get(`/api/v1/conversations/${conversationId}`)
      .then((detail) => setMessages(detail.messages))
      .catch(() => setMessages([]))
      .finally(() => setLoadingConvo(false));
  }, [conversationId]);

  // A stream continues while navigating around the SPA. Reload the persisted
  // conversation when returning to it, including after the response completes.
  useEffect(() => {
    if (!conversationId || streaming || !isConversationActive(conversationId)) {
      setBackgroundProcessing(false);
      return undefined;
    }
    setBackgroundProcessing(true);
    let cancelled = false;
    const refresh = async () => {
      try {
        const detail = await api.get(`/api/v1/conversations/${conversationId}`);
        if (!cancelled) setMessages(detail.messages);
      } catch {
        // The normal conversation load handles missing/deleted conversations.
      }
      if (!isConversationActive(conversationId) && !cancelled) {
        setBackgroundProcessing(false);
      }
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, streaming]);

  const sendMessage = async (text) => {
    if (!selectedModelId || (responseMode !== "chat" && modeModels.length === 0)) return;
    const modePrefix = responseMode === "zip" ? "/zip " : responseMode === "photo" ? "/photo " : responseMode === "video" ? "/video " : "";
    const requestText = text.startsWith("/") || responseMode === "chat" ? text : `${modePrefix}${text}`;
    const automaticWebSearch = LIVE_WEB_CUES.test(text);
    const effectiveWebSearch = webSearch || allSources || automaticWebSearch;
    setStreamError(null);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const emitTelemetry = (event) => emitSystemEvent({ ...event, runId });
    emitTelemetry({ kind: "chat", node: "input", title: "Question received", detail: text.slice(0, 90), status: "running" });

    const userMsg = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    const assistantMsg = {
      id: `local-assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      model_display_name: models.find((m) => m.id === selectedModelId)?.display_name,
      created_at: new Date().toISOString(),
      rag_chunks: [],
      web_sources: [],
      artifact: null,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    if (conversationId) {
      markConversationActive(conversationId, {
        model: models.find((m) => m.id === selectedModelId)?.display_name,
        title: "Generating response",
      });
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let resolvedConversationId = conversationId;

    try {
      await streamChatCompletion(
        {
          conversationId,
          modelId: selectedModelId,
          message: requestText,
          kbId: selectedKbId,
          webSearch: effectiveWebSearch,
          agentWorkflow,
        },
        (event) => {
          if (event.type === "start") {
            emitTelemetry({ kind: "system", node: "router", title: "Request routed", detail: event.model_display_name || "Selecting model", status: "running" });
            if (event.rag_chunks?.length) emitTelemetry({ kind: "retrieval", node: "knowledge", title: "Knowledge retrieved", detail: `${event.rag_chunks.length} relevant chunks`, status: "complete" });
            if (event.web_sources?.length) emitTelemetry({ kind: "web", node: "web", title: "Web sources found", detail: `${event.web_sources.length} live sources`, status: "complete" });
            if (event.web_error) {
              emitTelemetry({ kind: "web", node: "web", title: "Web search unavailable", detail: event.web_error, status: "error" });
              setStreamError(`Web search: ${event.web_error}`);
            }
            if (event.memory_used) emitTelemetry({ kind: "memory", node: "memory", title: "Memory context loaded", detail: "Approved memories added to the model context", status: "complete" });
            resolvedConversationId = event.conversation_id;
            activeConversationIdRef.current = event.conversation_id;
            if (!conversationId) {
              try {
                const saved = JSON.parse(localStorage.getItem("nexus-response-modes") || "{}");
                saved[event.conversation_id] = responseMode;
                localStorage.setItem("nexus-response-modes", JSON.stringify(saved));
              } catch {
                // Response mode persistence is optional.
              }
            }
            markConversationActive(event.conversation_id, {
              model: event.model_display_name,
              title: "Generating response",
            });
            setBackgroundProcessing(false);
            // Attach retrieved chunks to the in-progress assistant message
            if (event.rag_chunks?.length) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = { ...last, rag_chunks: event.rag_chunks };
                }
                return next;
              });
            }
            if (event.web_sources?.length) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = { ...last, web_sources: event.web_sources };
                }
                return next;
              });
            }
            if (!conversationId) onConversationChange?.();
          } else if (event.type === "artifact_status") {
            emitTelemetry({ kind: "artifact", node: "artifact", title: "Building ZIP", detail: event.detail || "Preparing archive", status: "running" });
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant" && !last.content) {
                next[next.length - 1] = { ...last, content: event.detail || "Preparing the generated project…" };
              }
              return next;
            });
          } else if (event.type === "artifact") {
            const artifact = event.download_url
              ? { ...event, download_url: `${API_BASE_URL}${event.download_url}` }
              : event;
            const available = Boolean(event.download_url);
            emitTelemetry({
              kind: "artifact",
              node: "artifact",
              title: available ? "Artifact ready" : "Artifact request recognized",
              detail: event.name || event.detail || event.kind,
              status: available ? "complete" : "error",
            });
            if (available) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  const artifacts = [...(last.artifacts || (last.artifact ? [last.artifact] : [])), artifact];
                  next[next.length - 1] = { ...last, artifacts, artifact: artifacts[0] };
                }
                return next;
              });
            }
          } else if (event.type === "workflow") {
            setWorkflowStatus(event);
            emitTelemetry({ kind: "model", node: event.status === "planning" ? "router" : "model", title: `Workflow ${event.status}`, detail: event.label || "Agent processing", status: event.status === "complete" ? "complete" : "running" });
          } else if (event.type === "delta") {
            emitTelemetry({ kind: "model", node: "model", title: "Model streaming", detail: "Generating response tokens", status: "running" });
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + event.content };
              }
              return next;
            });
          } else if (event.type === "error") {
            setStreamError(event.message);
            emitTelemetry({ kind: "model", node: "model", title: "Processing failed", detail: event.message, status: "error" });
          } else if (event.type === "done") {
            if (event.error) setStreamError(event.error);
            markConversationComplete(resolvedConversationId || conversationId);
            emitTelemetry({ kind: "chat", node: "output", title: event.error ? "Response failed" : "Response delivered", detail: event.error || "Stream complete", status: event.error ? "error" : "complete" });
            if (!event.error && resolvedConversationId) {
              api.post("/api/v1/memories/suggest", {
                model_id: selectedModelId,
                conversation_id: resolvedConversationId,
              }).then(setMemorySuggestions).catch(() => {});
            }
          }
        },
        controller.signal
      );
    } catch (err) {
      setStreamError(err instanceof ApiError ? err.message : "Connection to the server was lost.");
    } finally {
      markConversationComplete(resolvedConversationId || conversationId);
      setStreaming(false);
      setWorkflowStatus(null);
      onConversationChange?.();
      if (!conversationId && resolvedConversationId) {
        navigate(`/c/${resolvedConversationId}`, { replace: true });
      }
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const regenerateLast = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((prev) => prev.slice(0, -1));
    await sendMessage(lastUser.content);
  };

  const saveMessageToMemory = async (message) => {
    if (!message.content?.trim() || savedMemoryIds.has(message.id)) return;
    setSavingMemory(message.id);
    try {
      await api.post("/api/v1/memories", {
        content: message.content.trim(),
        category: "fact",
        source_conversation_id: activeConversationIdRef.current || conversationId || null,
      });
      setSavedMemoryIds((current) => new Set(current).add(message.id));
      emitSystemEvent({
        kind: "memory",
        node: "memory",
        title: "Message saved to memory",
        detail: `${message.role === "user" ? "User message" : "Model response"} added to long-term memory`,
        status: "complete",
      });
    } catch (err) {
      setStreamError(err instanceof ApiError ? err.message : "Could not save this message to memory.");
    } finally {
      setSavingMemory(null);
    }
  };

  const noModels = models.length === 0;

  return (
    <div className="chat-view">
      <style>{`
        .chat-view { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
        .chat-header {
          display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
          padding: 10px var(--space-5);
          border-bottom: 1px solid var(--border-subtle);
          position: sticky; top: 0; z-index: 80; flex-shrink: 0;
          background: color-mix(in srgb, var(--bg-1) 94%, transparent);
          backdrop-filter: blur(14px);
        }
        .chat-header-divider {
          width: 1px; height: 20px; background: var(--border);
          flex-shrink: 0;
        }
        .token-counter {
          margin-left: auto;
          color: var(--text-tertiary);
          font-size: 12px;
          white-space: nowrap;
        }
        .web-toggle {
          border: 1px solid var(--border); background: var(--bg-2); color: var(--text-secondary);
          border-radius: var(--radius-md); padding: 6px 10px; font-size: 13px; cursor: pointer;
          transition: none; user-select: none;
        }
        .web-toggle:hover, .web-toggle.active {
          border-color: var(--accent); color: var(--accent); background: var(--accent-dim);
        }
        .chat-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
        @media (max-width: 860px) {
          .chat-header {
            flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;
            padding: 8px 12px; touch-action: pan-x; min-height:44px;
            position: relative; z-index: 120;
          }
          .chat-header::-webkit-scrollbar { display: none; }
          .chat-header-divider { height: 20px; }
          .token-counter { margin-left: 0; flex-shrink: 0; }
          .web-toggle { flex-shrink: 0; min-height: 36px; }
        }
        .chat-welcome {
          height: 100%; display: flex; flex-direction: column; align-items: center;
          justify-content: center; text-align: center; padding: var(--space-5);
        }
        .chat-welcome .icon-badge {
          width: 52px; height: 52px; border-radius: var(--radius-lg);
          background: var(--accent-dim); color: var(--accent);
          display: flex; align-items: center; justify-content: center;
          margin-bottom: var(--space-4);
        }
        .chat-welcome h2 { font-size: 20px; margin: 0 0 var(--space-2); }
        .chat-welcome p { color: var(--text-secondary); font-size: 14px; max-width: 420px; margin: 0; }
      `}</style>

      <div className="chat-header">
        <ModelSelector models={modeModels} selectedModelId={selectedModelId} onSelect={setSelectedModelId} />
        {knowledgeBases.length > 0 && (
          <>
            <div className="chat-header-divider" />
            <KBSelector
              knowledgeBases={knowledgeBases}
              selectedKbId={selectedKbId}
              onSelect={setSelectedKbId}
            />
          </>
        )}
        <div className="token-counter" title="Estimated from message text; actual provider tokenization may differ">
          {remainingTokens === null
            ? `~${formatTokenCount(usedTokens)} tokens used`
            : `${formatTokenCount(remainingTokens)} tokens left`}
        </div>
        {workflowStatus && (
          <div style={{ padding: "0 var(--space-5) var(--space-2)", color: "var(--text-tertiary)", fontSize: 12 }}>
            {workflowStatus.status === "planning"
              ? "Planning task…"
              : workflowStatus.status === "synthesizing"
              ? "Preparing final answer…"
              : workflowStatus.label
                ? `Step ${workflowStatus.step}/${workflowStatus.total}: ${workflowStatus.label}`
                : "Workflow complete"}
          </div>
        )}
        {backgroundProcessing && !streaming && (
          <div style={{ padding: "0 var(--space-5) var(--space-2)", color: "var(--accent)", fontSize: 12 }}>
            Response is continuing in the background…
          </div>
        )}
      </div>

      <div className="chat-body">
        {loadingConvo ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-6)" }}>
            <div className="spinner" />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="icon-badge">
              <Sparkles size={24} />
            </div>
            <h2>{noModels ? "Connect a provider to get started" : "Start a conversation"}</h2>
            <p>
              {noModels
                ? "Add a provider connection and enable at least one model in the Model Library."
                : selectedKbId
                ? `RAG is active — responses will be grounded in your "${knowledgeBases.find((k) => k.id === selectedKbId)?.name}" knowledge base.`
                : "Pick a model above and send your first message. Add a knowledge base to ground answers in your own documents."}
            </p>
          </div>
        ) : (
          <Suspense fallback={<div className="chat-loading-messages"><div className="spinner" /></div>}>
            <MessageList
              messages={messages}
              streaming={streaming}
              onRegenerate={regenerateLast}
              onSaveMemory={saveMessageToMemory}
              savingMemory={savingMemory}
              savedMemoryIds={savedMemoryIds}
            />
          </Suspense>
        )}
      </div>

      {memorySuggestions.length > 0 && (
        <div className="memory-suggestions" role="dialog" aria-label="Memory suggestions">
          <style>{`
            .memory-suggestions { margin: 0 var(--space-5) var(--space-3); padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-2); }
            .memory-suggestions h3 { margin: 0 0 6px; font-size: 13px; }
            .memory-suggestion { display:flex; align-items:center; gap:8px; padding:7px 0; border-top:1px solid var(--border-subtle); font-size:13px; }
            .memory-suggestion span { flex:1; color:var(--text-secondary); }
          `}</style>
          <h3>Save useful memory?</h3>
          {memorySuggestions.map((suggestion, index) => (
            <div className="memory-suggestion" key={`${suggestion.content}-${index}`}>
              <span>{suggestion.content}</span>
              <button
                className="btn btn-primary"
                disabled={savingMemory === index}
                onClick={async () => {
                  setSavingMemory(index);
                  try {
                    await api.post("/api/v1/memories", suggestion);
                    setMemorySuggestions((current) => current.filter((_, itemIndex) => itemIndex !== index));
                  } finally {
                    setSavingMemory(null);
                  }
                }}
              >
                Add
              </button>
              <button className="btn btn-ghost" onClick={() => setMemorySuggestions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                Skip
              </button>
            </div>
          ))}
        </div>
      )}

      {streamError && (
        <div className="error-text" style={{ padding: "0 var(--space-5) var(--space-2)" }}>
          {streamError}
        </div>
      )}

      <Composer
        onSend={sendMessage}
        onStop={stopStreaming}
        streaming={streaming}
        disabled={!selectedModelId || (responseMode !== "chat" && modeModels.length === 0)}
        webSearch={webSearch}
        allSources={allSources}
        responseMode={responseMode}
        onResponseModeChange={selectResponseMode}
        agentWorkflow={agentWorkflow}
        onToggleWeb={toggleWebSearch}
        onToggleAllSources={toggleAllSources}
        onToggleAgent={toggleAgentWorkflow}
      />
    </div>
  );
}

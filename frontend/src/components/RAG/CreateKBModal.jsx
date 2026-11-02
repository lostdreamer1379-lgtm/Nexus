import { useEffect, useState } from "react";
import { X, Info } from "lucide-react";
import { api, ApiError } from "../../api/client";

export const COMMON_EMBEDDING_MODELS = [
  { id: "text-embedding-3-small", label: "OpenAI text-embedding-3-small (recommended)", providers: ["openai"] },
  { id: "text-embedding-3-large", label: "OpenAI text-embedding-3-large", providers: ["openai"] },
  { id: "text-embedding-ada-002", label: "OpenAI text-embedding-ada-002 (legacy)", providers: ["openai"] },
  { id: "nvidia/nv-embedqa-e5-v5", label: "NVIDIA NV-EmbedQA-E5-v5", providers: ["nvidia"] },
  { id: "gemini-embedding-001", label: "Google gemini-embedding-001", providers: ["gemini"] },
  { id: "custom", label: "Enter a custom model ID", providers: ["openrouter", "openai", "nvidia", "gemini", "anthropic", "custom"] },
];

export default function CreateKBModal({ onClose, onCreated }) {
  const [connections, setConnections] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [embeddingModelChoice, setEmbeddingModelChoice] = useState("text-embedding-3-small");
  const [customModelId, setCustomModelId] = useState("");
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(64);
  const [retrievalK, setRetrievalK] = useState(5);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifiedEmbeddingModels, setVerifiedEmbeddingModels] = useState([]);
  const [checkingEmbeddingModels, setCheckingEmbeddingModels] = useState(false);

  const selectedConnection = connections.find((connection) => connection.id === connectionId);
  const embeddingModels = verifiedEmbeddingModels;

  useEffect(() => {
    api.get("/api/v1/providers/connections").then((list) => {
      const connected = list.filter((c) => c.connection_status === "connected");
      setConnections(connected);
      if (connected.length > 0) {
        setConnectionId(connected[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedConnection) {
      setVerifiedEmbeddingModels([]);
      return;
    }
    setCheckingEmbeddingModels(true);
    api.post(`/api/v1/providers/connections/${selectedConnection.id}/embedding-models/check`)
      .then((result) => {
        setVerifiedEmbeddingModels(result.models || []);
        setEmbeddingModelChoice(result.models?.[0]?.id || "custom");
      })
      .catch(() => {
        setVerifiedEmbeddingModels([]);
        setEmbeddingModelChoice("custom");
      })
      .finally(() => setCheckingEmbeddingModels(false));
  }, [selectedConnection]);

  useEffect(() => {
    if (embeddingModels.length > 0 && !embeddingModels.some((model) => model.id === embeddingModelChoice)) {
      setEmbeddingModelChoice(embeddingModels[0].id);
      setCustomModelId("");
    }
  }, [embeddingModels, embeddingModelChoice]);

  const effectiveModelId =
    embeddingModelChoice === "custom" ? customModelId.trim() : embeddingModelChoice;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!effectiveModelId) {
      setError("Please enter an embedding model ID.");
      return;
    }
    setSubmitting(true);
    try {
      if (embeddingModelChoice === "custom" && connectionId) {
        const check = await api.post(
          `/api/v1/providers/connections/${connectionId}/embedding-models/check`,
          { custom_model_id: effectiveModelId }
        );
        if (!check.models?.some((model) => model.id === effectiveModelId)) {
          throw new Error("The custom embedding model failed the live capability check.");
        }
      }
      const kb = await api.post("/api/v1/rag/knowledge-bases", {
        name: name.trim(),
        description: description.trim() || null,
        embedding_connection_id: connectionId || null,
        embedding_model_id: effectiveModelId,
        chunk_size: Number(chunkSize),
        chunk_overlap: Number(chunkOverlap),
        retrieval_k: Number(retrievalK),
      });
      onCreated(kb);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="modal-title">Create knowledge base</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              placeholder="e.g. Product Documentation"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label>Description (optional)</label>
            <input
              className="input"
              placeholder="What kind of documents will this hold?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Embedding provider connection</label>
            {connections.length === 0 ? (
              <p className="field-hint" style={{ color: "var(--warning)" }}>
                No connected providers found. Add one in the Provider Manager first. You can
                still create this knowledge base and configure embeddings later.
              </p>
            ) : (
              <select
                className="input"
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.connection_name}
                  </option>
                ))}
              </select>
            )}
            <span className="field-hint">
              This connection is used to generate embeddings for your documents and queries.
              Any OpenAI-compatible provider that offers an embeddings endpoint works.
            </span>
          </div>

          <div className="field">
            <label>Embedding model</label>
            <select
              className="input"
              value={embeddingModelChoice}
              onChange={(e) => {
                setEmbeddingModelChoice(e.target.value);
                if (e.target.value !== "custom") setCustomModelId("");
              }}
            >
            {checkingEmbeddingModels && <option value="">Checking available embedding models…</option>}
            {embeddingModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label} ({m.dimensions}d)</option>
            ))}
            <option value="custom">Enter a custom model ID</option>
            </select>
            {embeddingModelChoice === "custom" && (
              <input
                className="input"
                style={{ marginTop: 8 }}
                placeholder="e.g. sentence-transformers/all-MiniLM-L6-v2"
                value={customModelId}
                onChange={(e) => setCustomModelId(e.target.value)}
              />
            )}
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 13, marginBottom: "var(--space-3)", padding: "4px 0" }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide" : "Show"} advanced chunking settings
          </button>

          {showAdvanced && (
            <div className="card" style={{ marginBottom: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Chunk size (chars)</label>
                  <input
                    type="number" className="input" min={64} max={4096} step={64}
                    value={chunkSize} onChange={(e) => setChunkSize(e.target.value)}
                  />
                </div>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Chunk overlap (chars)</label>
                  <input
                    type="number" className="input" min={0} max={512} step={16}
                    value={chunkOverlap} onChange={(e) => setChunkOverlap(e.target.value)}
                  />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Top-k chunks per query</label>
                <input
                  type="number" className="input" min={1} max={20}
                  value={retrievalK} onChange={(e) => setRetrievalK(e.target.value)}
                />
                <span className="field-hint">
                  How many chunks are injected into the model's context per question. Higher = more context, more tokens used.
                </span>
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim()}>
              {submitting ? <span className="spinner" /> : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

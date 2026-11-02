import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Trash2, RefreshCw, FileText, AlertCircle, CheckCircle, Clock, Loader, GitCompare, Network } from "lucide-react";
import { api, ApiError, uploadDocument } from "../../api/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { emitSystemEvent } from "../../utils/systemEvents.js";
import { COMMON_EMBEDDING_MODELS } from "./CreateKBModal.jsx";

const STATUS_META = {
  pending:    { icon: Clock,       color: "var(--text-tertiary)", label: "Queued" },
  processing: { icon: Loader,      color: "var(--accent)",        label: "Processing" },
  ready:      { icon: CheckCircle, color: "var(--success)",       label: "Ready" },
  error:      { icon: AlertCircle, color: "var(--danger)",        label: "Error" },
};

function DocRow({ doc, onDelete, onReprocess }) {
  const meta = STATUS_META[doc.status] || STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <div className="doc-row">
      <div className="doc-icon"><FileText size={15} /></div>
      <div className="doc-info">
        <p className="doc-name">{doc.filename}</p>
        <span className="doc-meta">
          {(doc.file_size_bytes / 1024).toFixed(1)} KB
          {doc.chunk_count > 0 ? ` · ${doc.chunk_count} chunks` : ""}
        </span>
        {doc.error && <p className="doc-error">{doc.error}</p>}
      </div>
      <div className="doc-status" style={{ color: meta.color }}>
        <Icon size={14} />
        <span>{meta.label}</span>
      </div>
      <div className="doc-actions">
        {doc.status === "error" && (
          <button className="btn btn-ghost btn-icon" onClick={() => onReprocess(doc)} title="Retry ingestion">
            <RefreshCw size={14} />
          </button>
        )}
        <button className="btn btn-ghost btn-icon" onClick={() => onDelete(doc)} title="Remove document">
          <Trash2 size={14} color="var(--danger)" />
        </button>
      </div>
    </div>
  );
}

export default function KBDetailPanel({ kb, onUpdated, onDelete }) {
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [models, setModels] = useState([]);
  const [connections, setConnections] = useState([]);
  const [embeddingConnectionId, setEmbeddingConnectionId] = useState(kb.embedding_connection_id || "");
  const [embeddingModelChoice, setEmbeddingModelChoice] = useState(kb.embedding_model_id);
  const [customEmbeddingModel, setCustomEmbeddingModel] = useState("");
  const [savingEmbedding, setSavingEmbedding] = useState(false);
  const [embeddingError, setEmbeddingError] = useState(null);
  const embeddingInitializedRef = useRef(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [compareModel, setCompareModel] = useState("");
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState(null);
  const [comparisonHistory, setComparisonHistory] = useState([]);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [graphBuilding, setGraphBuilding] = useState(false);
  const [graphError, setGraphError] = useState(null);
  const [facts, setFacts] = useState([]);
  const [factsBuilding, setFactsBuilding] = useState(false);
  const [factsError, setFactsError] = useState(null);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const loadDocs = useCallback(async () => {
    try {
      const list = await api.get(`/api/v1/rag/knowledge-bases/${kb.id}/documents`);
      setDocuments(list);
      return list;
    } catch {
      return [];
    } finally {
      setLoadingDocs(false);
    }
  }, [kb.id]);

  useEffect(() => {
    setLoadingDocs(true);
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    api.get("/api/v1/models?enabled_only=true").then((list) => {
      setModels(list);
      setCompareModel((current) => current || list[0]?.id || "");
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/api/v1/providers/connections").then((list) => {
      const connected = list.filter((connection) => connection.connection_status === "connected");
      setConnections(connected);
      setEmbeddingConnectionId((current) => current || kb.embedding_connection_id || connected[0]?.id || "");
    }).catch(() => {});
  }, [kb.embedding_connection_id]);

  const selectedEmbeddingConnection = connections.find((connection) => connection.id === embeddingConnectionId);
  const embeddingModels = COMMON_EMBEDDING_MODELS.filter((model) =>
    model.providers.includes(selectedEmbeddingConnection?.provider_type)
  );
  const effectiveEmbeddingModel = embeddingModelChoice === "custom" ? customEmbeddingModel.trim() : embeddingModelChoice;

  useEffect(() => {
    if (embeddingInitializedRef.current || !selectedEmbeddingConnection) return;
    const isKnownModel = embeddingModels.some((model) => model.id === kb.embedding_model_id);
    setEmbeddingModelChoice(isKnownModel ? kb.embedding_model_id : "custom");
    if (!isKnownModel) setCustomEmbeddingModel(kb.embedding_model_id);
    embeddingInitializedRef.current = true;
  }, [embeddingModels, kb.embedding_model_id, selectedEmbeddingConnection]);

  const saveEmbeddingSettings = async () => {
    if (!effectiveEmbeddingModel || !embeddingConnectionId) {
      setEmbeddingError("Choose an embedding connection and model.");
      return;
    }
    setEmbeddingError(null);
    setSavingEmbedding(true);
    try {
      const updated = await api.patch(`/api/v1/rag/knowledge-bases/${kb.id}`, {
        embedding_connection_id: embeddingConnectionId,
        embedding_model_id: effectiveEmbeddingModel,
      });
      onUpdated(updated);
      setEmbeddingModelChoice(updated.embedding_model_id);
      setCustomEmbeddingModel("");
    } catch (err) {
      setEmbeddingError(err instanceof ApiError ? err.message : "Could not update embedding settings.");
    } finally {
      setSavingEmbedding(false);
    }
  };

  const loadComparisonHistory = useCallback(async () => {
    try {
      setComparisonHistory(await api.get(`/api/v1/rag/knowledge-bases/${kb.id}/comparisons`));
    } catch {
      setComparisonHistory([]);
    }
  }, [kb.id]);

  useEffect(() => {
    loadComparisonHistory();
  }, [loadComparisonHistory]);

  useEffect(() => {
    api.get(`/api/v1/rag/knowledge-bases/${kb.id}/graph`).then(setGraph).catch(() => {});
    api.get(`/api/v1/rag/knowledge-bases/${kb.id}/facts`).then(setFacts).catch(() => {});
  }, [kb.id]);

  // Poll for status updates while any doc is still processing
  useEffect(() => {
    clearInterval(pollRef.current);
    const hasPending = documents.some((d) => d.status === "pending" || d.status === "processing");
    if (hasPending) {
      pollRef.current = setInterval(async () => {
        const updated = await loadDocs();
        const stillPending = updated.some((d) => d.status === "pending" || d.status === "processing");
        if (!stillPending) clearInterval(pollRef.current);
      }, 2500);
    }
    return () => clearInterval(pollRef.current);
  }, [documents, loadDocs]);

  const handleFiles = async (files) => {
    const file = files[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    setUploadProgress(0);
    try {
      const doc = await uploadDocument(kb.id, file, setUploadProgress);
      setDocuments((prev) => [doc, ...prev]);
      // Trigger an updated KB count on the parent
      const updatedKb = await api.get(`/api/v1/rag/knowledge-bases/${kb.id}`);
      onUpdated(updatedKb);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteDoc = async (doc) => {
    if (!window.confirm(`Remove "${doc.filename}"?`)) return;
    await api.delete(`/api/v1/rag/knowledge-bases/${kb.id}/documents/${doc.id}`);
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    const updatedKb = await api.get(`/api/v1/rag/knowledge-bases/${kb.id}`);
    onUpdated(updatedKb);
  };

  const reprocessDoc = async (doc) => {
    const updated = await api.post(
      `/api/v1/rag/knowledge-bases/${kb.id}/documents/${doc.id}/reprocess`
    );
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
  };

  const compareDocuments = async () => {
    setCompareError(null);
    setComparison(null);
    setComparing(true);
    try {
      const result = await api.post(`/api/v1/rag/knowledge-bases/${kb.id}/compare`, {
        document_a_id: compareA,
        document_b_id: compareB,
        model_id: compareModel,
      });
      setComparison(result);
      loadComparisonHistory();
    } catch (err) {
      setCompareError(err instanceof ApiError ? err.message : "Comparison failed.");
    } finally {
      setComparing(false);
    }
  };

  const rateComparison = async (item, rating) => {
    const feedback = window.prompt("Optional feedback for improving future comparisons:", item.feedback || "");
    await api.patch(`/api/v1/rag/knowledge-bases/${kb.id}/comparisons/${item.id}`, { rating, feedback });
    loadComparisonHistory();
  };

  const buildGraph = async () => {
    setGraphError(null);
    setGraphBuilding(true);
    emitSystemEvent({ kind: "graph", node: "knowledge", title: "Knowledge graph extraction started", detail: "Extracting entities and relationships", status: "running" });
    try {
      const next = await api.post(`/api/v1/rag/knowledge-bases/${kb.id}/graph`, { model_id: compareModel });
      setGraph(next);
      emitSystemEvent({ kind: "graph", node: "knowledge", title: "Knowledge graph updated", detail: `${next.nodes.length} entities · ${next.edges.length} relationships`, status: "complete" });
    } catch (err) {
      setGraphError(err instanceof ApiError ? err.message : "Graph extraction failed.");
    } finally {
      setGraphBuilding(false);
    }
  };

  const refineFacts = async () => {
    setFactsError(null);
    setFactsBuilding(true);
    emitSystemEvent({ kind: "retrieval", node: "knowledge", title: "Fact refinement started", detail: "Checking documents for explicit and conflicting facts", status: "running" });
    try {
      const next = await api.post(`/api/v1/rag/knowledge-bases/${kb.id}/facts/refine`, { model_id: compareModel });
      setFacts(next);
      emitSystemEvent({ kind: "retrieval", node: "knowledge", title: "Facts refined", detail: `${next.length} facts available for review`, status: "complete" });
    } catch (err) {
      setFactsError(err instanceof ApiError ? err.message : "Fact refinement failed.");
    } finally {
      setFactsBuilding(false);
    }
  };

  const updateFact = async (fact, status) => {
    const updated = await api.patch(`/api/v1/rag/knowledge-bases/${kb.id}/facts/${fact.id}`, { status });
    setFacts((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="kb-detail">
      <style>{`
        .kb-detail { display: flex; flex-direction: column; gap: var(--space-4); }
        .kb-detail-header { display: flex; align-items: center; justify-content: space-between; }
        .kb-detail-header h2 { font-size: 17px; margin: 0; }
        .drop-zone {
          border: 2px dashed var(--border); border-radius: var(--radius-lg);
          padding: var(--space-5); text-align: center; cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
          background: var(--bg-1);
        }
        .drop-zone:hover, .drop-zone.dragging { border-color: var(--accent); background: var(--accent-dim); }
        .drop-zone p { color: var(--text-secondary); font-size: 14px; margin: 8px 0 0; }
        .drop-zone strong { color: var(--text-primary); }
        .upload-progress {
          height: 4px; border-radius: 2px; background: var(--bg-3); overflow: hidden; margin-top: 8px;
        }
        .upload-progress-bar {
          height: 100%; background: var(--accent);
          transition: width 0.2s ease; border-radius: 2px;
        }
        .doc-list { display: flex; flex-direction: column; gap: 2px; }
        .doc-row {
          display: flex; align-items: center; gap: 10px; padding: 10px 12px;
          background: var(--bg-1); border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }
        .doc-icon { color: var(--text-tertiary); flex-shrink: 0; }
        .doc-info { flex: 1; min-width: 0; }
        .doc-name { font-size: 13.5px; font-weight: 500; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .doc-meta { font-size: 12px; color: var(--text-tertiary); }
        .doc-error { font-size: 12px; color: var(--danger); margin: 4px 0 0; }
        .doc-status { display: flex; align-items: center; gap: 4px; font-size: 12px; flex-shrink: 0; }
        .doc-actions { display: flex; gap: 2px; flex-shrink: 0; }
        .kb-settings-card { background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: var(--space-4); }
        .kb-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
        .kb-setting { display: flex; flex-direction: column; gap: 3px; }
        .kb-setting-label { font-size: 12px; color: var(--text-tertiary); }
        .kb-setting-value { font-size: 13.5px; font-weight: 500; }
        .comparison-report { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-subtle); line-height: 1.6; }
        .comparison-report table { border-collapse: collapse; width: 100%; font-size: 13px; }
        .comparison-report th, .comparison-report td { border: 1px solid var(--border-subtle); padding: 7px 9px; text-align: left; }
        .comparison-report th { background: var(--bg-2); }
        .graph-summary { margin-top: 12px; }
        .graph-node { display: inline-block; margin: 3px 4px 3px 0; padding: 3px 8px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; }
        .graph-edge { padding: 6px 0; border-top: 1px solid var(--border-subtle); font-size: 12.5px; color: var(--text-secondary); }
        .graph-edge b { color: var(--accent); margin: 0 5px; }
        .embedding-editor { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
        .embedding-editor-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 480px) { .kb-settings-grid { grid-template-columns: 1fr; } }
      `}</style>

      <div className="kb-detail-header">
        <h2>{kb.name}</h2>
      </div>

      {/* Settings summary */}
      <div className="kb-settings-card">
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Embedding configuration
        </p>
        <div className="embedding-editor">
          <div className="kb-settings-grid">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Embedding provider connection</label>
              <select className="input" value={embeddingConnectionId} onChange={(e) => {
                setEmbeddingConnectionId(e.target.value);
                setEmbeddingModelChoice("");
                setCustomEmbeddingModel("");
              }}>
                <option value="">Select a connection</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.connection_name}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Embedding model</label>
              <select className="input" value={embeddingModelChoice} onChange={(e) => {
                setEmbeddingModelChoice(e.target.value);
                if (e.target.value !== "custom") setCustomEmbeddingModel("");
              }}>
                {embeddingModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                <option value="custom">Enter a custom model ID</option>
              </select>
              {embeddingModelChoice === "custom" && (
                <input
                  className="input"
                  style={{ marginTop: 8 }}
                  placeholder="Enter an embedding model ID"
                  value={customEmbeddingModel}
                  onChange={(e) => setCustomEmbeddingModel(e.target.value)}
                />
              )}
            </div>
          </div>
          <div className="embedding-editor-actions">
            <button className="btn btn-primary" onClick={saveEmbeddingSettings} disabled={savingEmbedding || !effectiveEmbeddingModel || !embeddingConnectionId}>
              {savingEmbedding ? "Saving…" : "Save embedding settings"}
            </button>
            {embeddingError && <span className="error-text">{embeddingError}</span>}
          </div>
          {documents.length > 0 && <span className="field-hint">Changing the embedding model may require reprocessing existing documents.</span>}
        </div>
        <div className="kb-settings-grid">
          <div className="kb-setting">
            <span className="kb-setting-label">Model</span>
            <span className="kb-setting-value">{kb.embedding_model_id}</span>
          </div>
          <div className="kb-settings-card" style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <RefreshCw size={16} color="var(--accent)" />
              <strong>Fact refinement</strong>
            </div>
            <p className="field-hint">Find explicit facts, flag contradictory values, and review them before use.</p>
            <button className="btn" onClick={refineFacts} disabled={factsBuilding || !compareModel || !documents.some((doc) => doc.status === "ready")}>
              {factsBuilding ? "Refining facts…" : "Refine knowledge-base facts"}
            </button>
            {factsError && <p className="error-text">{factsError}</p>}
            {facts.slice(0, 30).map((fact) => (
              <div key={fact.id} className="doc-row" style={{ marginTop: 6 }}>
                <div className="doc-info">
                  <p className="doc-name">{fact.subject} — {fact.predicate} — {fact.object}</p>
                  <span className="doc-meta">{fact.status}{fact.evidence ? ` · ${fact.evidence}` : ""}</span>
                </div>
                {fact.status !== "active" && <button className="btn btn-ghost" onClick={() => updateFact(fact, "active")}>Accept</button>}
                {fact.status !== "dismissed" && <button className="btn btn-ghost" onClick={() => updateFact(fact, "dismissed")}>Dismiss</button>}
              </div>
            ))}
          </div>
          <div className="kb-setting">
            <span className="kb-setting-label">Dimensions</span>
            <span className="kb-setting-value">{kb.embedding_dim ?? "—"}</span>
          </div>
          <div className="kb-setting">
            <span className="kb-setting-label">Chunk size</span>
            <span className="kb-setting-value">{kb.chunk_size} chars</span>
          </div>
          <div className="kb-setting">
            <span className="kb-setting-label">Overlap</span>
            <span className="kb-setting-value">{kb.chunk_overlap} chars</span>
          </div>
          <div className="kb-setting">
            <span className="kb-setting-label">Top-k retrieval</span>
            <span className="kb-setting-value">{kb.retrieval_k} chunks</span>
          </div>
          <div className="kb-setting">
            <span className="kb-setting-label">Documents</span>
            <span className="kb-setting-value">{kb.document_count}</span>
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`drop-zone ${dragging ? "dragging" : ""}`}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload size={22} color={dragging ? "var(--accent)" : "var(--text-tertiary)"} />
        <p>
          {uploading
            ? `Uploading… ${uploadProgress}%`
            : <><strong>Click to upload</strong> or drag and drop here</>
          }
        </p>
        <p style={{ fontSize: 12.5, marginTop: 4 }}>PDF, DOCX, TXT, MD, PNG, JPG, WEBP, TIFF · up to 50 MB per file</p>
        {uploading && (
          <div className="upload-progress">
            <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploadError && <p className="error-text">{uploadError}</p>}

      {documents.filter((doc) => doc.status === "ready").length >= 2 && (
        <div className="kb-settings-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <GitCompare size={16} color="var(--accent)" />
            <strong>Compare documents</strong>
          </div>
          <div className="kb-settings-grid">
            <select className="input" value={compareA} onChange={(e) => setCompareA(e.target.value)}>
              <option value="">First document</option>
              {documents.filter((doc) => doc.status === "ready").map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}
            </select>
            <select className="input" value={compareB} onChange={(e) => setCompareB(e.target.value)}>
              <option value="">Second document</option>
              {documents.filter((doc) => doc.status === "ready").map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}
            </select>
            <select className="input" value={compareModel} onChange={(e) => setCompareModel(e.target.value)}>
              <option value="">Comparison model</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.display_name}</option>)}
            </select>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={compareDocuments}
            disabled={comparing || !compareA || !compareB || !compareModel || compareA === compareB}
          >
            {comparing ? <span className="spinner" /> : <GitCompare size={15} />}
            {comparing ? "Comparing…" : "Generate comparison"}
          </button>
          {compareError && <p className="error-text">{compareError}</p>}
          {comparison && (
            <div className="comparison-report">
              <p className="doc-meta">{comparison.document_a} vs {comparison.document_b}</p>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{comparison.report}</ReactMarkdown>
            </div>
          )}

          <div className="kb-settings-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Network size={16} color="var(--accent)" />
              <strong>Knowledge graph</strong>
            </div>
            <p className="field-hint">Extract people, projects, technologies, and relationships from this knowledge base.</p>
            <button className="btn" onClick={buildGraph} disabled={graphBuilding || !compareModel || !documents.some((doc) => doc.status === "ready")}>
              {graphBuilding ? <span className="spinner" /> : <Network size={15} />}
              {graphBuilding ? "Building graph…" : "Build or refresh graph"}
            </button>
            {graphError && <p className="error-text">{graphError}</p>}
            {graph.nodes.length > 0 && (
              <div className="graph-summary">
                <p className="doc-meta">{graph.nodes.length} entities · {graph.edges.length} relationships</p>
                {graph.nodes.slice(0, 30).map((node) => (
                  <span key={node.id} className="graph-node" title={node.description || node.type}>
                    {node.name}
                  </span>
                ))}
                {graph.edges.slice(0, 20).map((edge) => {
                  const source = graph.nodes.find((node) => node.id === edge.source)?.name;
                  const target = graph.nodes.find((node) => node.id === edge.target)?.name;
                  return <div key={edge.id} className="graph-edge">{source} <b>{edge.relationship}</b> {target}</div>;
                })}
              </div>
            )}
          </div>
          {comparisonHistory.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className="doc-meta">Recent comparisons</p>
              {comparisonHistory.map((item) => (
                <div key={item.id} className="doc-row" style={{ marginTop: 6 }}>
                  <div className="doc-info">
                    <p className="doc-name">{item.document_a} vs {item.document_b}</p>
                    <span className="doc-meta">{item.status === "stale" ? "Needs refresh" : "Saved report"}</span>
                  </div>
                  <button className="btn btn-ghost btn-icon" title="Helpful" onClick={() => rateComparison(item, 1)}>👍</button>
                  <button className="btn btn-ghost btn-icon" title="Needs improvement" onClick={() => rateComparison(item, -1)}>👎</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Document list */}
      {loadingDocs ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4)" }}>
          <div className="spinner" />
        </div>
      ) : documents.length > 0 ? (
        <div className="doc-list">
          {documents.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              onDelete={deleteDoc}
              onReprocess={reprocessDoc}
            />
          ))}
        </div>
      ) : (
        <p style={{ color: "var(--text-tertiary)", fontSize: 14, textAlign: "center" }}>
          No documents yet. Upload one above to get started.
        </p>
      )}
    </div>
  );
}

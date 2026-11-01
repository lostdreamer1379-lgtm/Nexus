import { useEffect, useState } from "react";
import { Plus, Database } from "lucide-react";
import { api } from "../../api/client";
import KBCard from "./KBCard.jsx";
import CreateKBModal from "./CreateKBModal.jsx";
import KBDetailPanel from "./KBDetailPanel.jsx";

export default function KnowledgeBaseManager() {
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedKb, setSelectedKb] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.get("/api/v1/rag/knowledge-bases");
      setKbs(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (kb) => {
    if (!window.confirm(`Delete "${kb.name}"? All documents and embeddings will be permanently removed.`)) return;
    await api.delete(`/api/v1/rag/knowledge-bases/${kb.id}`);
    setKbs((prev) => prev.filter((k) => k.id !== kb.id));
    if (selectedKb?.id === kb.id) setSelectedKb(null);
  };

  const handleCreated = (kb) => {
    setKbs((prev) => [kb, ...prev]);
    setShowCreate(false);
    setSelectedKb(kb);
  };

  const handleUpdated = (kb) => {
    setKbs((prev) => prev.map((k) => (k.id === kb.id ? kb : k)));
    setSelectedKb(kb);
  };

  return (
    <div className="page">
      <style>{`
        .page { height: 100%; overflow-y: auto; padding: var(--space-6) var(--space-5); }
        .page-inner { max-width: 900px; margin: 0 auto; }
        .kb-layout { display: flex; gap: var(--space-5); align-items: flex-start; }
        .kb-list-col { flex: 0 0 320px; display: flex; flex-direction: column; gap: var(--space-3); }
        .kb-detail-col { flex: 1; min-width: 0; }
        @media (max-width: 720px) {
          .kb-layout { flex-direction: column; }
          .kb-list-col { flex: none; width: 100%; }
        }
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-5); gap: var(--space-3); }
        .page-header h1 { font-size: 20px; margin: 0 0 4px; }
        .page-header p { color: var(--text-secondary); font-size: 14px; margin: 0; }
      `}</style>

      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Knowledge Bases</h1>
            <p>Upload documents to ground chat responses in your own content.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New knowledge base
          </button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-7)" }}>
            <div className="spinner" />
          </div>
        ) : kbs.length === 0 ? (
          <div className="empty-state card">
            <Database size={28} color="var(--text-tertiary)" />
            <h3>No knowledge bases yet</h3>
            <p>
              Create one, upload PDFs, Word docs, or text files, and then select it in
              the chat header to ground responses in your documents.
            </p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> Create your first knowledge base
            </button>
          </div>
        ) : (
          <div className="kb-layout">
            <div className="kb-list-col">
              {kbs.map((kb) => (
                <KBCard
                  key={kb.id}
                  kb={kb}
                  active={selectedKb?.id === kb.id}
                  onClick={() => setSelectedKb(kb)}
                  onDelete={() => handleDelete(kb)}
                />
              ))}
            </div>
            <div className="kb-detail-col">
              {selectedKb ? (
                <KBDetailPanel
                  kb={selectedKb}
                  onUpdated={handleUpdated}
                  onDelete={() => handleDelete(selectedKb)}
                />
              ) : (
                <div className="card" style={{ color: "var(--text-tertiary)", fontSize: 14, padding: "var(--space-5)" }}>
                  Select a knowledge base to manage its documents and settings.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateKBModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../../api/client";

const CATEGORIES = ["preference", "profile", "workflow", "fact"];

export default function MemoriesPanel() {
  const [memories, setMemories] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editCategory, setEditCategory] = useState("fact");
  const [error, setError] = useState(null);

  const load = () => api.get("/api/v1/memories").then(setMemories).catch((err) => setError(err.message));
  useEffect(load, []);

  const update = async (memory, patch) => {
    try {
      const updated = await api.patch(`/api/v1/memories/${memory.id}`, {
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      });
      setMemories((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this memory?")) return;
    await api.delete(`/api/v1/memories/${id}`);
    setMemories((current) => current.filter((memory) => memory.id !== id));
  };

  const clear = async () => {
    if (!window.confirm("Delete all memories? This cannot be undone.")) return;
    await api.delete("/api/v1/memories");
    setMemories([]);
  };

  return (
    <div className="page">
      <style>{`
        .memory-page { width:100%; max-width:760px; margin:0 auto; box-sizing:border-box; }
        .memory-card { display:flex; gap:12px; align-items:flex-start; padding:14px 0; border-top:1px solid var(--border-subtle); box-sizing:border-box; }
        .memory-content { flex:1; min-width:0; color:var(--text-primary); line-height:1.45; overflow-wrap:anywhere; }
        .memory-meta { color:var(--text-tertiary); font-size:12px; margin-top:5px; }
        .memory-actions { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
        .memory-edit { flex:1; min-width:180px; }
        @media (max-width:600px) {
          .memory-page .page-header { flex-direction:column; align-items:stretch; }
          .memory-page .page-header > button { width:100%; justify-content:center; }
          .memory-card { flex-direction:column; gap:10px; }
          .memory-actions { width:100%; justify-content:flex-start; }
          .memory-actions .btn { flex:1; justify-content:center; }
          .memory-edit { width:100%; min-width:0; }
        }
      `}</style>
      <div className="memory-page">
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1>Memories</h1>
            <p>Approved memories help Nexus AI personalize answers across conversations.</p>
          </div>
          <button className="btn btn-ghost" onClick={clear} disabled={!memories.length}>Delete all</button>
        </div>
        {error && <p className="error-text">{error}</p>}
        {!memories.length ? <p className="doc-meta">No memories saved yet.</p> : memories.map((memory) => (
          <div className="memory-card" key={memory.id}>
            {editingId === memory.id ? (
              <>
                <div className="memory-edit">
                  <textarea className="input" rows={3} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                  <select className="input" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} style={{ marginTop: 6 }}>
                    {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
                <div className="memory-actions">
                  <button className="btn btn-primary" onClick={() => update(memory, { content: editValue, category: editCategory })}>Save</button>
                  <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="memory-content">
                  {memory.content}
                  <div className="memory-meta">{memory.category} · {memory.status}</div>
                </div>
                <div className="memory-actions">
                  {memory.status !== "approved" && <button className="btn btn-ghost" onClick={() => update(memory, { status: "approved" })}>Approve</button>}
                  <button className="btn btn-ghost" onClick={() => { setEditingId(memory.id); setEditValue(memory.content); setEditCategory(memory.category); }}>Edit</button>
                  <button className="btn btn-ghost" onClick={() => remove(memory.id)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

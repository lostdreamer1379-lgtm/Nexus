import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client";
import { applyTheme } from "../../utils/theme.js";
import { emitSystemEvent } from "../../utils/systemEvents.js";

export default function SettingsPanel() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(null);
  const [models, setModels] = useState([]);
  const [saved, setSaved] = useState(false);
  const [memories, setMemories] = useState([]);
  const [refiningMemories, setRefiningMemories] = useState(false);

  useEffect(() => {
    Promise.all([api.get("/api/v1/settings"), api.get("/api/v1/models?enabled_only=true")]).then(([p, m]) => {
      setPrefs(p);
      applyTheme(p.theme);
      setModels(m);
      api.get("/api/v1/memories").then(setMemories).catch(() => {});
    });
  }, []);

  const save = async (patch) => {
    if (patch.theme) applyTheme(patch.theme);
    const updated = await api.patch("/api/v1/settings", patch);
    setPrefs(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const refineMemories = async () => {
    if (!models[0]) return;
    emitSystemEvent({ kind: "memory", node: "memory", title: "Memory refinement started", detail: "Analyzing conversation history", status: "running" });
    setRefiningMemories(true);
    try {
      const created = await api.post("/api/v1/memories/refine", { model_id: models[0].id });
      setMemories((current) => [...created, ...current]);
      emitSystemEvent({ kind: "memory", node: "memory", title: "Memories refined", detail: `${created.length} candidate memories found`, status: "complete" });
    } finally {
      setRefiningMemories(false);
    }
  };

  const updateMemory = async (memory, status) => {
    const updated = await api.patch(`/api/v1/memories/${memory.id}`, { status });
    setMemories((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  if (!prefs) return null;

  return (
    <div className="page">
      <style>{`
        .page { height: 100%; overflow-y: auto; padding: var(--space-6) var(--space-5); }
        .page-inner { max-width: 560px; margin: 0 auto; }
        .page-header { margin-bottom: var(--space-5); }
        .page-header h1 { font-size: 20px; margin: 0 0 4px; }
        .page-header p { color: var(--text-secondary); font-size: 14px; margin: 0; }
        .settings-section { margin-bottom: var(--space-5); }
        .settings-section h2 { font-size: 14px; font-weight: 600; margin: 0 0 var(--space-3); color: var(--text-secondary); }
        .saved-pill { font-size: 12px; color: var(--success); }
        .account-row { display: flex; justify-content: space-between; font-size: 14px; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); }
        .account-row:last-child { border-bottom: none; }
        .account-row span:first-child { color: var(--text-secondary); }
      `}</style>
      <div className="page-inner">
        <div className="page-header">
          <h1>Settings</h1>
          <p>Preferences for how Nexus AI looks and behaves for your account.</p>
        </div>

        <div className="settings-section card">
          <h2>Appearance</h2>
          <div className="field">
            <label>Theme</label>
            <select className="input" value={prefs.theme} onChange={(e) => save({ theme: e.target.value })}>
              <option value="dark">Dark</option>
              <option value="amoled">AMOLED black</option>
            </select>
          </div>
        </div>

        <div className="settings-section card">
          <h2>Default model</h2>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Used to pre-select a model for new conversations</label>
            <select
              className="input"
              value={prefs.default_model_id || ""}
              onChange={(e) => save({ default_model_id: e.target.value || null })}
            >
              <option value="">No default — ask each time</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-section card">
            <h2>Memory</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 0 }}>
              Review facts and preferences Nexus AI may use in future conversations.
            </p>
            <button className="btn btn-primary" onClick={refineMemories} disabled={refiningMemories || !models.length}>
              {refiningMemories ? "Finding memories…" : "Refine from conversation history"}
            </button>
            {memories.length === 0 ? (
              <p className="doc-meta">No memories found.</p>
            ) : memories.map((memory) => (
              <div key={memory.id} className="account-row" style={{ gap: 10, alignItems: "center" }}>
                <span style={{ flex: 1 }}>{memory.content}</span>
                <span className="doc-meta">{memory.status}</span>
                {memory.status !== "approved" && (
                  <button className="btn btn-ghost" onClick={() => updateMemory(memory, "approved")}>Approve</button>
                )}
                {memory.status !== "archived" && (
                  <button className="btn btn-ghost" onClick={() => updateMemory(memory, "archived")}>Archive</button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="settings-section card">
          <h2>Account</h2>
          <div className="account-row">
            <span>Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="account-row">
            <span>Member since</span>
            <span>{new Date(user?.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        {saved && <p className="saved-pill">Saved</p>}
      </div>
    </div>
  );
}

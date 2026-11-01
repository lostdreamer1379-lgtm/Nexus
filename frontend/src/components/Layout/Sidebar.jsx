import { useEffect, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import {
  Hexagon,
  Plus,
  Search,
  MessageSquare,
  Plug,
  Boxes,
  Database,
  Settings,
  LogOut,
  X,
  Pencil,
  Trash2,
  Activity,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client";

export default function Sidebar({ mobileOpen, onCloseMobile, conversationsVersion }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const [conversations, setConversations] = useState([]);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  const loadConversations = async () => {
    try {
      const list = await api.get("/api/v1/conversations");
      setConversations(list);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    loadConversations();
    window.addEventListener("nexus-conversations-changed", loadConversations);
    return () => window.removeEventListener("nexus-conversations-changed", loadConversations);
  }, [conversationsVersion]);

  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));

  const startNewConversation = () => {
    navigate("/");
    onCloseMobile();
  };

  const openConversation = (id) => {
    navigate(`/c/${id}`);
    onCloseMobile();
  };

  const deleteConversation = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    await api.delete(`/api/v1/conversations/${id}`);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) navigate("/");
  };

  const beginRename = (e, convo) => {
    e.stopPropagation();
    setRenamingId(convo.id);
    setRenameValue(convo.title);
  };

  const commitRename = async (id) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    await api.patch(`/api/v1/conversations/${id}`, { title });
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  };

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onCloseMobile} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <style>{`
          .sidebar {
            width: 272px;
            flex-shrink: 0;
            background: var(--bg-1);
            border-right: 1px solid var(--border-subtle);
            display: flex;
            flex-direction: column;
            padding: var(--space-4);
            padding-top: calc(var(--space-4) + env(safe-area-inset-top, 0px));
          }
          .sidebar-backdrop {
            display: none;
          }
          .sb-brand {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-5);
          }
          .sb-brand-mark {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            color: var(--text-primary);
            font-weight: 600;
            font-size: 15px;
          }
          .sb-brand-mark svg { color: var(--accent); }
          .sb-close { display: none; }
          .sb-search {
            position: relative;
            margin-bottom: var(--space-3);
          }
          .sb-search svg {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-tertiary);
          }
          .sb-search input {
            padding-left: 34px;
          }
          .sb-nav {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin-bottom: var(--space-4);
          }
          .sb-link {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            padding: 9px 10px;
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
          }
          .sb-link:hover { background: var(--bg-2); color: var(--text-primary); }
          .sb-link.active { background: var(--bg-2); color: var(--text-primary); }
          .sb-section-label {
            font-size: 12px;
            color: var(--text-tertiary);
            margin: var(--space-2) 2px 4px;
          }
          .sb-conversations {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 1px;
            margin: 0 -4px;
            padding: 0 4px;
          }
          .sb-convo {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: 8px 8px;
            border-radius: var(--radius-sm);
            cursor: pointer;
            color: var(--text-secondary);
            font-size: 13.5px;
            position: relative;
          }
          .sb-convo:hover { background: var(--bg-2); color: var(--text-primary); }
          .sb-convo.active { background: var(--bg-2); color: var(--text-primary); }
          .sb-convo-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .sb-convo-actions {
            display: none;
            gap: 2px;
          }
          .sb-convo:hover .sb-convo-actions { display: flex; }
          .sb-convo-actions button {
            background: transparent;
            border: none;
            color: var(--text-tertiary);
            cursor: pointer;
            padding: 3px;
            border-radius: 4px;
          }
          .sb-convo-actions button:hover { color: var(--text-primary); background: var(--bg-3); }
          .sb-rename-input {
            flex: 1;
            background: var(--bg-3);
            border: 1px solid var(--accent);
            border-radius: 4px;
            color: var(--text-primary);
            font-size: 13.5px;
            padding: 3px 6px;
          }
          .sb-account {
            border-top: 1px solid var(--border-subtle);
            padding-top: var(--space-3);
            margin-top: var(--space-3);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
          }
          .sb-account-email {
            font-size: 13px;
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          @media (max-width: 860px) {
            .sidebar {
              position: fixed;
              inset: 0 auto 0 0;
              z-index: 200;
              transform: translateX(-100%);
              transition: transform 0.18s ease;
              box-shadow: 0 0 0 rgba(0,0,0,0);
            }
            .sidebar-open { transform: translateX(0); box-shadow: 20px 0 40px rgba(0,0,0,0.3); }
            .sidebar-backdrop {
              display: block;
              position: fixed;
              inset: 0;
              background: rgba(0,0,0,0.5);
              z-index: 199;
            }
            .sb-close { display: inline-flex; }
          }
        `}</style>

        <div className="sb-brand">
          <div className="sb-brand-mark">
            <Hexagon size={20} strokeWidth={2.2} />
            <span>Nexus AI</span>
          </div>
          <button className="btn btn-ghost btn-icon sb-close" onClick={onCloseMobile} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <button className="btn btn-primary" style={{ justifyContent: "center", marginBottom: "var(--space-4)" }} onClick={startNewConversation}>
          <Plus size={16} /> New conversation
        </button>

        <div className="sb-nav">
          <NavLink to="/providers" className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`} onClick={onCloseMobile}>
            <Plug size={16} /> Provider Manager
          </NavLink>
          <NavLink to="/models" className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`} onClick={onCloseMobile}>
            <Boxes size={16} /> Model Library
          </NavLink>
          <NavLink to="/knowledge-bases" className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`} onClick={onCloseMobile}>
            <Database size={16} /> Knowledge Bases
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`} onClick={onCloseMobile}>
            <Settings size={16} /> Settings
          </NavLink>
          <NavLink to="/visualizer" className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`} onClick={onCloseMobile}>
            <Activity size={16} /> System Visualizer
          </NavLink>
        </div>

        <div className="sb-search">
          <Search size={15} />
          <input
            className="input"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="sb-section-label">Recent</div>
        <div className="sb-conversations">
          {filtered.length === 0 && (
            <div style={{ color: "var(--text-tertiary)", fontSize: 13, padding: "8px" }}>
              {conversations.length === 0 ? "No conversations yet" : "No matches"}
            </div>
          )}
          {filtered.map((c) => (
            <div
              key={c.id}
              className={`sb-convo ${conversationId === c.id ? "active" : ""}`}
              onClick={() => openConversation(c.id)}
            >
              <MessageSquare size={14} />
              {renamingId === c.id ? (
                <input
                  className="sb-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(c.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="sb-convo-title">{c.title}</span>
              )}
              <div className="sb-convo-actions">
                <button onClick={(e) => beginRename(e, c)} aria-label="Rename">
                  <Pencil size={13} />
                </button>
                <button onClick={(e) => deleteConversation(e, c.id)} aria-label="Delete">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sb-account">
          <span className="sb-account-email" title={user?.email}>
            {user?.email}
          </span>
          <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Log out" title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}

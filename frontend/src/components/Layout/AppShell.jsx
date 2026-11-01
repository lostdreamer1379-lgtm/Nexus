import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import ChatView from "../Chat/ChatView.jsx";
import ProviderManager from "../Providers/ProviderManager.jsx";
import ModelLibrary from "../Models/ModelLibrary.jsx";
import SettingsPanel from "../Settings/SettingsPanel.jsx";
import KnowledgeBaseManager from "../RAG/KnowledgeBaseManager.jsx";
import { Menu } from "lucide-react";
import SystemVisualizer from "../SystemVisualizer/SystemVisualizer.jsx";
import { api } from "../../api/client";
import { applyTheme } from "../../utils/theme.js";

export default function AppShell() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [conversationsVersion, setConversationsVersion] = useState(0);
  const bumpConversations = () => setConversationsVersion((v) => v + 1);

  useEffect(() => {
    api.get("/api/v1/settings").then((prefs) => applyTheme(prefs.theme));
  }, []);

  return (
    <div className="shell">
      <style>{`
        .shell {
          height: 100vh;
          height: 100dvh;
          display: flex;
          background: var(--bg-0);
        }
        .shell-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .mobile-topbar {
          display: none;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          padding-top: calc(var(--space-3) + env(safe-area-inset-top, 0px));
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-1);
        }
        .mobile-topbar span {
          font-weight: 600;
          font-size: 14px;
        }
        @media (max-width: 860px) {
          .mobile-topbar {
            display: flex;
          }
        }
      `}</style>

      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        conversationsVersion={conversationsVersion}
      />

      <div className="shell-main">
        <div className="mobile-topbar">
          <button className="btn btn-ghost btn-icon" onClick={() => setMobileSidebarOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <span>Nexus AI</span>
        </div>

        <Routes>
          <Route path="/" element={<ChatView onConversationChange={bumpConversations} />} />
          <Route path="/c/:conversationId" element={<ChatView onConversationChange={bumpConversations} />} />
          <Route path="/providers" element={<ProviderManager />} />
          <Route path="/models" element={<ModelLibrary />} />
          <Route path="/knowledge-bases" element={<KnowledgeBaseManager />} />
          <Route path="/settings" element={<SettingsPanel />} />
          <Route path="/visualizer" element={<SystemVisualizer />} />
        </Routes>
      </div>
    </div>
  );
}

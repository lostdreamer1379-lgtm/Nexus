import { useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import ChatView from "../Chat/ChatView.jsx";
import ProviderManager from "../Providers/ProviderManager.jsx";
import ModelLibrary from "../Models/ModelLibrary.jsx";
import SettingsPanel from "../Settings/SettingsPanel.jsx";
import KnowledgeBaseManager from "../RAG/KnowledgeBaseManager.jsx";
import { Menu } from "lucide-react";
import SystemVisualizer from "../SystemVisualizer/SystemVisualizer.jsx";
import MemoriesPanel from "../Memories/MemoriesPanel.jsx";
import { api } from "../../api/client";
import { applyTheme } from "../../utils/theme.js";

export default function AppShell() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const touchStart = useRef(null);
  const [conversationsVersion, setConversationsVersion] = useState(0);
  const bumpConversations = () => setConversationsVersion((v) => v + 1);

  const onTouchStart = (event) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event) => {
    if (!touchStart.current) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    const fromEdge = touchStart.current.x <= 32;
    touchStart.current = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    if (!mobileSidebarOpen && fromEdge && dx > 0) setMobileSidebarOpen(true);
    if (mobileSidebarOpen && dx < 0) setMobileSidebarOpen(false);
  };

  useEffect(() => {
    api.get("/api/v1/settings").then((prefs) => applyTheme(prefs.theme));
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateViewportHeight = () => {
      const height = viewport?.height || window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
    };
    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    viewport?.addEventListener("resize", updateViewportHeight);
    viewport?.addEventListener("scroll", updateViewportHeight);
    return () => {
      window.removeEventListener("resize", updateViewportHeight);
      viewport?.removeEventListener("resize", updateViewportHeight);
      viewport?.removeEventListener("scroll", updateViewportHeight);
    };
  }, []);

  return (
    <div className="shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <style>{`
        .shell {
          height: var(--app-height, 100dvh);
          min-height: var(--app-height, 100dvh);
          display: flex;
          background: var(--bg-0);
        }
        .shell-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .mobile-topbar {
          display: none;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          padding-top: calc(var(--space-3) + env(safe-area-inset-top, 0px));
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-1);
          position: sticky;
          top: 0;
          z-index: 90;
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
          <Route path="/memories" element={<MemoriesPanel />} />
          <Route path="/visualizer" element={<SystemVisualizer />} />
        </Routes>
      </div>
    </div>
  );
}

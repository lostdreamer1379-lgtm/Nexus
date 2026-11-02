const routeLoaders = {
  "/providers": () => import("../components/Providers/ProviderManager.jsx"),
  "/models": () => import("../components/Models/ModelLibrary.jsx"),
  "/knowledge-bases": () => import("../components/RAG/KnowledgeBaseManager.jsx"),
  "/settings": () => import("../components/Settings/SettingsPanel.jsx"),
  "/memories": () => import("../components/Memories/MemoriesPanel.jsx"),
  "/visualizer": () => import("../components/SystemVisualizer/SystemVisualizer.jsx"),
};

const preloadedRoutes = new Map();

export function preloadRoute(path) {
  const load = routeLoaders[path];
  if (!load || preloadedRoutes.has(path)) return;
  const promise = load().catch(() => {
    preloadedRoutes.delete(path);
  });
  preloadedRoutes.set(path, promise);
}

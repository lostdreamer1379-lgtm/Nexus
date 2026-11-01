const STORAGE_KEY = "nexus-active-conversations";

function readTasks() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  window.dispatchEvent(new Event("nexus-background-task"));
}

export function markConversationActive(conversationId, details = {}) {
  if (!conversationId) return;
  const tasks = readTasks();
  tasks[conversationId] = { startedAt: Date.now(), ...details };
  writeTasks(tasks);
}

export function markConversationComplete(conversationId) {
  if (!conversationId) return;
  const tasks = readTasks();
  delete tasks[conversationId];
  writeTasks(tasks);
}

export function isConversationActive(conversationId) {
  return Boolean(conversationId && readTasks()[conversationId]);
}

export function subscribeBackgroundTasks(listener) {
  const onChange = () => listener(readTasks());
  window.addEventListener("nexus-background-task", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("nexus-background-task", onChange);
    window.removeEventListener("storage", onChange);
  };
}

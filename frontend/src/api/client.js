export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
import { emitSystemEvent } from "../utils/systemEvents.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include", // send the HttpOnly session cookie
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = (data && data.detail) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: "DELETE" }),
};

/**
 * Streams a chat completion via SSE. Calls onEvent for each parsed event
 * ({ type: "start"|"delta"|"error"|"done", ... }) as it arrives.
 */
export async function streamChatCompletion({ conversationId, modelId, message, kbId, webSearch, agentWorkflow }, onEvent, signal) {
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/completions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: conversationId,
      model_id: modelId,
      message,
      kb_id: kbId || null,
      web_search: Boolean(webSearch),
      agent_workflow: Boolean(agentWorkflow),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBuffer = () => {
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const dataLines = part
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .filter(Boolean);
      if (!dataLines.length) continue;
      try {
        onEvent(JSON.parse(dataLines.join("\n")));
      } catch {
        // Ignore malformed server events without interrupting the stream.
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      processBuffer();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }
}

/** Upload a document to a knowledge base. Returns the KBDocument object. */
export async function uploadDocument(kbId, file, onProgress) {
  emitSystemEvent({ kind: "upload", node: "input", title: "Document upload started", detail: file.name, status: "running" });
  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/v1/rag/knowledge-bases/${kbId}/documents`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 201) {
        emitSystemEvent({ kind: "upload", node: "knowledge", title: "Document uploaded", detail: file.name, status: "complete" });
        resolve(JSON.parse(xhr.responseText));
      } else {
        let detail = `Upload failed (${xhr.status})`;
        try { detail = JSON.parse(xhr.responseText).detail || detail; } catch {}
        emitSystemEvent({ kind: "upload", node: "knowledge", title: "Document upload failed", detail, status: "error" });
        reject(new ApiError(detail, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));
    xhr.send(formData);
  });
}

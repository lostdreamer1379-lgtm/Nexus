const listeners = new Set();
const history = [];
const MAX_EVENTS = 120;

export function emitSystemEvent(event) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    ...event,
  };
  history.push(item);
  if (history.length > MAX_EVENTS) history.shift();
  listeners.forEach((listener) => listener(item));
}

export function subscribeSystemEvents(listener) {
  listeners.add(listener);
  history.forEach(listener);
  return () => listeners.delete(listener);
}

export function clearSystemEvents() {
  history.length = 0;
  listeners.forEach((listener) => listener({ type: "reset" }));
}

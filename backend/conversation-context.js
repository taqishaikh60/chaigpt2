// Server-owned context; customer-supplied history cannot set pending actions.
function createConversationContexts({ now = Date.now } = {}) {
  const contexts = new Map();
  const lifetime = 30 * 60 * 1000;
  return {
    get(id) {
      const entry = contexts.get(id);
      if (!entry || now() - entry.updatedAt >= lifetime) { contexts.delete(id); return {}; }
      return structuredClone(entry.value);
    },
    set(id, value) {
      for (const [key, entry] of contexts) if (now() - entry.updatedAt >= lifetime) contexts.delete(key);
      contexts.delete(id);
      if (contexts.size >= 1000) contexts.delete(contexts.keys().next().value);
      contexts.set(id, { value: structuredClone(value), updatedAt: now() });
    },
  };
}
module.exports = { createConversationContexts };

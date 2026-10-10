function confirmOrder(sessions, sessionId, menu, promotions, pricing) {
  const confirmationToken = sessions.review(sessionId, menu);
  return sessions.update(sessionId, {
    confirmed: true, ...(confirmationToken ? { confirmationToken } : {}),
  }, menu, promotions, pricing);
}

module.exports = { confirmOrder };

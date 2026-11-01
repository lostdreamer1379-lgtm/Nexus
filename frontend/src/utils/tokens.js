// A lightweight estimate for UI guidance; exact tokenization varies by provider.
export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

export function estimateMessageTokens(messages) {
  return messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0);
}

export function formatTokenCount(tokens) {
  return new Intl.NumberFormat().format(Math.max(0, tokens));
}

// Chat with your Tabs - Conversation Memory
// Manages conversation history for context in AI queries

// Conversation history: sessionId -> array of messages
const conversationHistory = new Map(); // sessionId -> [{role: 'user'|'assistant', content: string, timestamp: number, results?: [], candidates?: [], actionResult?: {}}]

// ACCURACY: Store disambiguation candidates for follow-up understanding
const disambiguationCandidates = new Map(); // sessionId -> {candidates: [{cardId, title, domain, index}], intent: {}, timestamp}

// SPEED: Cache formatted conversation context
const contextCache = new Map(); // sessionId -> {formatted: string, timestamp: number, length: number}
const CACHE_TTL = 30000; // 30 seconds

// Get or create session ID for current chat
export function getChatSessionId() {
  // Use a simple session ID (could be improved with proper session management)
  return 'default_chat_session';
}

// Add message to conversation history
export function addToConversationHistory(sessionId, role, content, results = null) {
  if (!conversationHistory.has(sessionId)) {
    conversationHistory.set(sessionId, []);
  }
  const history = conversationHistory.get(sessionId);
  history.push({
    role: role,
    content: content,
    timestamp: Date.now(),
    results: results
  });
  
  // Keep last 20 messages per session to prevent memory bloat
  if (history.length > 20) {
    history.shift();
  }
}

// Add Tabitha response to conversation history (wrapper for consistency)
export function addTabithaResponse(sessionId, content, results = null) {
  addToConversationHistory(sessionId, 'assistant', content, results);
}

// Get conversation history for context
export function getConversationHistory(sessionId, maxMessages = 10) {
  const history = conversationHistory.get(sessionId) || [];
  return history.slice(-maxMessages); // Get last N messages
}

// ACCURACY: Store disambiguation candidates for follow-up understanding
export function addDisambiguationCandidates(sessionId, candidates, intent) {
  disambiguationCandidates.set(sessionId, {
    candidates: candidates.map((c, i) => ({
      cardId: c.card?.cardId || c.cardId,
      title: c.card?.title || c.title || 'Untitled',
      domain: c.card?.domain || c.domain || 'unknown',
      index: i + 1
    })),
    intent: intent,
    timestamp: Date.now()
  });
}

// ACCURACY: Get last disambiguation candidates for anaphora resolution
export function getLastDisambiguationCandidates(sessionId) {
  const stored = disambiguationCandidates.get(sessionId);
  if (!stored) return null;
  
  // Expire after 5 minutes
  if (Date.now() - stored.timestamp > 300000) {
    disambiguationCandidates.delete(sessionId);
    return null;
  }
  
  return stored;
}

// ACCURACY: Store action result for richer context
export function addActionResult(sessionId, intent, result, candidates = null) {
  const history = conversationHistory.get(sessionId) || [];
  const lastMsg = history[history.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    lastMsg.actionResult = { intent, result, candidates };
  }
}

// Format conversation history for prompt context (with caching)
export function formatConversationForPrompt(sessionId) {
  const history = getConversationHistory(sessionId, 10);
  if (history.length === 0) return '';
  
  // SPEED: Check cache first
  const cacheKey = `${sessionId}_${history.length}`;
  const cached = contextCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL && cached.length === history.length) {
    return cached.formatted;
  }
  
  // ACCURACY: Format richer context with action results
  const formatted = history.map(msg => {
    let line = `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`;
    
    // Include action results if available
    if (msg.actionResult) {
      const { intent, result, candidates } = msg.actionResult;
      if (candidates && candidates.length > 0) {
        line += `\n[Action: ${intent}, Result: ${result.ok ? 'success' : 'failed'}, Candidates: ${candidates.length} items]`;
      } else {
        line += `\n[Action: ${intent}, Result: ${result.ok ? 'success' : 'failed'}]`;
      }
    }
    
    if (msg.results && msg.results.length > 0) {
      line += `\n[Results: ${msg.results.length} items found]`;
    }
    return line;
  }).join('\n') + '\n';
  
  // SPEED: Cache the formatted context
  contextCache.set(cacheKey, { formatted, timestamp: Date.now(), length: history.length });
  return formatted;
}


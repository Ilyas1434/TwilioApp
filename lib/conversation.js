/**
 * Conversation storage for Luna chatbot.
 * Uses Upstash Redis when configured; falls back to in-memory store for local dev.
 *
 * Setup (production):
 * 1. Create Redis database at https://console.upstash.com (free tier available)
 * 2. Add to Vercel: Project → Storage → Create Database → Redis (Upstash)
 * 3. Or set env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 *
 * Session expiry: 24 hours of inactivity (configurable via SESSION_TTL_SECONDS)
 */

const SESSION_TTL = parseInt(process.env.SESSION_TTL_SECONDS || "86400", 10); // 24 hours
const MAX_MESSAGES = 20; // Keep last 20 messages to stay within token limits

// In-memory fallback for local dev when Redis isn't configured
const memoryStore = new Map();
let hasWarnedNoRedis = false;

function getRedisClient() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;

  try {
    // Dynamic import to avoid errors when @upstash/redis isn't installed
    const { Redis } = require("@upstash/redis");
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

const redis = getRedisClient();

function sessionKey(phoneNumber) {
  return `luna:${phoneNumber.replace(/\D/g, "")}`;
}

function createEmptySession() {
  return {
    messages: [],
    state: {
      ageRange: null,
      mainReason: null,
      severity: null,
      branchesVisited: [],
      escalationIssued: false,
      stage: "entry",
    },
    lastActivity: Date.now(),
  };
}

/**
 * Load conversation for a user. Returns session object or null.
 */
async function getSession(phoneNumber) {
  const key = sessionKey(phoneNumber);

  if (redis) {
    try {
      const raw = await redis.get(key);
      if (!raw) return null;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      return { ...createEmptySession(), ...data };
    } catch (err) {
      console.error("Redis get error:", err);
      return memoryStore.get(key) || null;
    }
  }

  return memoryStore.get(key) || null;
}

/**
 * Save conversation for a user. Truncates message history to stay within limits.
 */
async function saveSession(phoneNumber, session) {
  const key = sessionKey(phoneNumber);

  // Truncate messages to avoid token overflow
  const messages = session.messages.slice(-MAX_MESSAGES);
  const toSave = {
    ...session,
    messages,
    lastActivity: Date.now(),
  };

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(toSave), { ex: SESSION_TTL });
    } catch (err) {
      console.error("Redis set error:", err);
      memoryStore.set(key, toSave);
    }
  } else {
    memoryStore.set(key, toSave);
    if (!hasWarnedNoRedis && process.env.NODE_ENV !== "test") {
      hasWarnedNoRedis = true;
      console.warn(
        "[Luna] Redis not configured. Using in-memory store (data lost on restart). Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for persistence."
      );
    }
  }
}

/**
 * Append a message and optionally update state. Returns updated session.
 */
async function appendMessage(phoneNumber, role, content, stateUpdate = null) {
  let session = await getSession(phoneNumber);

  if (!session) {
    session = createEmptySession();
  }

  session.messages.push({ role, content });
  if (stateUpdate && typeof stateUpdate === "object") {
    session.state = { ...session.state, ...stateUpdate };
  }
  session.lastActivity = Date.now();

  await saveSession(phoneNumber, session);
  return session;
}

/**
 * Build messages array for OpenAI: system + conversation history + new user message.
 */
function buildMessages(systemPrompt, session, newUserMessage) {
  const messages = [{ role: "system", content: systemPrompt }];

  if (session?.messages?.length) {
    // Add conversation history (already truncated in storage)
    for (const msg of session.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: "user", content: newUserMessage });
  return messages;
}

module.exports = {
  getSession,
  saveSession,
  appendMessage,
  buildMessages,
  createEmptySession,
  SESSION_TTL,
  MAX_MESSAGES,
};

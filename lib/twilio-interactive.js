/**
 * WhatsApp interactive message support via Twilio Content API.
 * Parses button patterns from Luna's responses and sends them as
 * tappable WhatsApp buttons (quick replies or list pickers).
 */

const crypto = require("crypto");

// In-memory fallback cache for content SIDs (when Redis unavailable)
const memoryCache = new Map();

/**
 * Parse button patterns from Luna's response.
 * Matches *[Button Text]* and **[Button Text]** formats.
 * Returns { body, buttons } with button patterns stripped from body.
 */
function parseButtons(text) {
  const buttonRegex = /\*{1,2}\[([^\]]+)\]\*{1,2}/g;
  const buttons = [];
  let match;
  while ((match = buttonRegex.exec(text)) !== null) {
    buttons.push(match[1].trim());
  }

  if (buttons.length === 0) return { body: text, buttons: [] };

  const body = text
    .replace(buttonRegex, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { body, buttons };
}

/**
 * Truncate a button title to fit WhatsApp limits.
 */
function truncateTitle(title, maxLen) {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + "\u2026";
}

/**
 * Generate a Redis cache key from button titles.
 */
function buttonCacheKey(buttons) {
  const hash = crypto
    .createHash("md5")
    .update(buttons.join("|"))
    .digest("hex")
    .slice(0, 12);
  return `luna:content:${hash}`;
}

/**
 * Get or create a Twilio Content Template SID for a set of buttons.
 * Caches in Redis (or memory) to avoid recreating identical templates.
 */
async function getOrCreateContentSid(client, redis, buttons) {
  const cacheKey = buttonCacheKey(buttons);

  // Check cache
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    } catch (e) {
      // fall through to memory cache
    }
  }
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  // Determine content type based on button count
  const isQuickReply = buttons.length <= 3;
  let types;

  if (isQuickReply) {
    types = {
      twilioQuickReply: {
        body: "{{1}}",
        actions: buttons.map((btn, i) => ({
          title: truncateTitle(btn, 20),
          id: `opt_${i}`,
        })),
      },
    };
  } else {
    types = {
      twilioListPicker: {
        body: "{{1}}",
        button: "Choose",
        items: buttons.map((btn, i) => ({
          id: `item_${i}`,
          title: truncateTitle(btn, 24),
        })),
      },
    };
  }

  const content = await client.content.v1.contents.create({
    friendlyName: `luna_${cacheKey.slice(-12)}`,
    language: "en",
    variables: { "1": "message body" },
    types,
  });

  const sid = content.sid;

  // Cache the SID
  if (redis) {
    try {
      await redis.set(cacheKey, sid, { ex: 86400 * 365 }); // 1 year
    } catch (e) {
      memoryCache.set(cacheKey, sid);
    }
  } else {
    memoryCache.set(cacheKey, sid);
  }

  return sid;
}

/**
 * Send a reply to a WhatsApp user, with interactive buttons if detected.
 * Falls back to plain text if Content API fails or no buttons found.
 */
async function sendReply(client, redis, twilioFrom, to, text) {
  const { body, buttons } = parseButtons(text);
  console.log(`[Interactive] Parsed ${buttons.length} buttons:`, buttons);

  if (buttons.length > 0 && buttons.length <= 10) {
    try {
      console.log("[Interactive] Creating/fetching content template...");
      const contentSid = await getOrCreateContentSid(client, redis, buttons);
      console.log(`[Interactive] Content SID: ${contentSid}, sending message...`);
      await client.messages.create({
        from: twilioFrom,
        to: to,
        contentSid: contentSid,
        contentVariables: JSON.stringify({ "1": body }),
      });
      console.log("[Interactive] Message sent with buttons!");
      return;
    } catch (err) {
      console.error(
        "Interactive message failed, falling back to text:",
        err.message
      );
    }
  }

  // Fallback: send as plain text
  await client.messages.create({
    from: twilioFrom,
    to: to,
    body: text,
  });
}

module.exports = { parseButtons, sendReply };

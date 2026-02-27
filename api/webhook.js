const twilio = require("twilio");
const OpenAI = require("openai");
const querystring = require("querystring");
const {
  getSession,
  appendMessage,
  buildMessages,
} = require("../lib/conversation");
const LUNA_SYSTEM_PROMPT = require("../lib/luna-prompt");

// Vercel doesn't auto-parse urlencoded bodies, so we need to do it manually
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(querystring.parse(data)));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // Parse the body if not already parsed
    const body = req.body || (await parseBody(req));

    const incomingMessage = body.Body;
    const from = body.From;

    console.log(`Message from ${from}: ${incomingMessage}`);
    console.log(`OPENAI_API_KEY set: ${!!process.env.OPENAI_API_KEY}`);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Load conversation history for this user (keyed by phone number)
    const session = await getSession(from);
    const messages = buildMessages(LUNA_SYSTEM_PROMPT, session, incomingMessage);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 1500,
    });

    const reply = completion.choices[0].message.content;

    // Persist conversation for next turn
    await appendMessage(from, "user", incomingMessage);
    await appendMessage(from, "assistant", reply);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  } catch (error) {
    console.error("Webhook error:", error);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Sorry, something went wrong. Please try again.");

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  }
};

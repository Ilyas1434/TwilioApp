const twilio = require("twilio");
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Validate the request is from Twilio
  const signature = req.headers["x-twilio-signature"];
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const url = `https://${req.headers.host}${req.url}`;

  if (!twilio.validateRequest(authToken, signature, url, req.body)) {
    return res.status(403).send("Unauthorized");
  }

  const incomingMessage = req.body.Body;
  const from = req.body.From;

  console.log(`Message from ${from}: ${incomingMessage}`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant replying via WhatsApp. Keep responses concise and under 1500 characters.",
        },
        { role: "user", content: incomingMessage },
      ],
      max_tokens: 500,
    });

    const reply = completion.choices[0].message.content;

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  } catch (error) {
    console.error("Error generating response:", error);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Sorry, something went wrong. Please try again.");

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  }
};

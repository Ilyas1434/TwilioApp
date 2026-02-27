const twilio = require("twilio");
const OpenAI = require("openai");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const incomingMessage = req.body.Body;
    const from = req.body.From;

    console.log(`Message from ${from}: ${incomingMessage}`);

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
    console.error("Webhook error:", error.message);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Sorry, something went wrong. Please try again.");

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  }
};

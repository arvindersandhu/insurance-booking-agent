// AI replies: uses an OpenAI-compatible API when a key is set, otherwise
// falls back to simple scripted replies so the agent works with no AI at all.
const { log } = require('./log');

const hasKey = Boolean(process.env.OPENAI_API_KEY);
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are a friendly booking assistant for an insurance sales agent. ` +
  `Keep replies to 1-2 short sentences, warm and plain. Never invent prices, coverage details, ` +
  `or promises. If the customer asks about prices, coverage, complaints or refunds, say you will ` +
  `get the agent to answer personally. Never ask for sensitive personal information in chat.`;

async function aiReply(history, userMessage) {
  if (!hasKey) return null; // caller uses the scripted fallback
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.map((h) => ({ role: h.role, content: h.text })),
          { role: 'user', content: userMessage },
        ],
        temperature: 0.5,
        max_tokens: 120,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      log('ai_error', { error: data.error && data.error.message });
      return null;
    }
    return data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content.trim()
      : null;
  } catch (e) {
    log('ai_error', { error: e.message });
    return null;
  }
}

// Scripted fallback: used when no AI key is set, or if the AI call fails.
// The conversation flow in flow.js builds the exact question/booking messages;
// this only covers small friendly acknowledgements in between.
function scriptedReply(stage) {
  const replies = {
    greeting: "Thanks for reaching out! I'll help you get a meeting booked.",
    thanks: 'Got it, thank you!',
    confirm: 'Perfect, you are all set!',
  };
  return replies[stage] || replies.thanks;
}

module.exports = { aiReply, scriptedReply, aiEnabled: hasKey };

// Webhook server for Meta's Instagram webhooks.
//  GET  /webhook  — Meta's verification handshake (hub.challenge)
//  POST /webhook  — comment + message events from Instagram
//  GET  /health   — quick "is it running?" check
//  GET  /activity — the activity log (what the agent did)
//  GET  /bookings — mock-calendar bookings (only in mock mode)
require('dotenv').config();
const express = require('express');
const { log, getEntries } = require('./log');
const flow = require('./flow');
const calendar = require('./calendar');
const { aiEnabled } = require('./llm');

const app = express();
app.use(express.json({ limit: '1mb' }));

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'change-me-verify-token';
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    mode: {
      calendar: calendar.mode,
      ai: aiEnabled ? 'openai' : 'scripted',
      instagram: process.env.IG_PAGE_ACCESS_TOKEN ? 'live' : 'dry-run',
    },
  });
});

app.get('/activity', (req, res) => {
  res.json({ entries: getEntries() });
});

app.get('/bookings', (req, res) => {
  if (calendar.mode !== 'mock') {
    return res.status(400).json({ error: 'bookings list is only available in mock mode' });
  }
  res.json({ events: calendar.listMockEvents() });
});

// Meta verification: Meta calls this once when you save the webhook URL.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    log('webhook_verified', {});
    return res.status(200).send(challenge);
  }
  log('webhook_verify_failed', { mode });
  return res.sendStatus(403);
});

// Incoming events from Instagram.
app.post('/webhook', async (req, res) => {
  // Answer Meta immediately, then do the work — Meta retries if we are slow.
  res.status(200).send('EVENT_RECEIVED');
  try {
    const body = req.body;
    if (!body || body.object !== 'instagram') return;
    for (const entry of body.entry || []) {
      // 1. Comments on a post/reel.
      for (const change of entry.changes || []) {
        if (change.field !== 'comments') continue;
        const v = change.value || {};
        const text = (v.text || '').trim();
        await flow.handleComment({
          commentId: v.id,
          commenterId: v.from && v.from.id,
          mediaId: v.media && (v.media.id || v.media_id),
          text,
        });
      }
      // 2. Direct messages.
      for (const msg of entry.messaging || []) {
        if (!msg.message || !msg.message.text) continue;
        await flow.handleMessage({
          senderId: msg.sender && msg.sender.id,
          text: msg.message.text,
        });
      }
    }
  } catch (e) {
    log('webhook_error', { error: e.message });
    console.error(e);
  }
});

// Test-only helper: run one comment + DM exchange without Meta.
// POST /test/comment { commentId, commenterId, mediaId, text }
// POST /test/message { senderId, text }
app.post('/test/comment', async (req, res) => {
  const result = await flow.handleComment(req.body);
  res.json(result);
});
app.post('/test/message', async (req, res) => {
  const result = await flow.handleMessage(req.body);
  res.json(result);
});

// Only start listening when run directly (npm start), not when required by tests.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Instagram booking agent listening on port ${PORT}`);
    console.log(`Calendar: ${calendar.mode} | AI: ${aiEnabled ? 'openai' : 'scripted'} | Instagram: ${process.env.IG_PAGE_ACCESS_TOKEN ? 'live' : 'dry-run'}`);
    log('server_started', { port: PORT, calendar: calendar.mode });
  });
}

module.exports = app;

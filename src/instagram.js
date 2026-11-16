// Talking to Instagram: sends DMs through Meta's Instagram Messaging API.
// In dry-run mode (no IG_PAGE_ACCESS_TOKEN set) messages are logged, not sent,
// so the whole flow can be tested without any Meta account.
const { log } = require('./log');

const GRAPH_URL = 'https://graph.facebook.com/v21.0';

const dryRun = !process.env.IG_PAGE_ACCESS_TOKEN;

async function sendDM(recipientId, text) {
  if (dryRun) {
    log('dm_sent_dry_run', { to: recipientId, text });
    return { dryRun: true, ok: true };
  }
  const res = await fetch(
    `${GRAPH_URL}/me/messages?access_token=${process.env.IG_PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    log('dm_send_failed', { to: recipientId, error: data.error && data.error.message });
    throw new Error('Instagram send failed: ' + (data.error && data.error.message));
  }
  log('dm_sent', { to: recipientId, messageId: data.message_id });
  return data;
}

// Private reply: answers a comment with a DM (Instagram's "private replies").
// This is what fires when a comment matches a trigger word.
async function sendPrivateReply(commentId, text) {
  if (dryRun) {
    log('private_reply_dry_run', { commentId, text });
    return { dryRun: true, ok: true };
  }
  const res = await fetch(
    `${GRAPH_URL}/me/messages?access_token=${process.env.IG_PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    log('private_reply_failed', { commentId, error: data.error && data.error.message });
    throw new Error('Private reply failed: ' + (data.error && data.error.message));
  }
  log('private_reply_sent', { commentId, messageId: data.message_id });
  return data;
}

module.exports = { sendDM, sendPrivateReply, dryRun };

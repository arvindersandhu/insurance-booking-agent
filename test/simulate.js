// Simulates the full customer journey WITHOUT any Meta or Google account:
//   1. Webhook verification handshake
//   2. A customer comments QUOTE on the QUOTE video
//   3. The customer answers the two qualifying questions by DM
//   4. The customer picks a time slot
//   5. The meeting is booked on the mock calendar
// Also checks: a wrong trigger word, and a human handoff.
// Run:  npm test        (or: node test/simulate.js)
require('dotenv').config();
const app = require('../src/server');

const PORT = 3456;
const BASE = `http://localhost:${PORT}`;

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text; // e.g. "EVENT_RECEIVED" from the real webhook endpoint
  }
}

async function get(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, body: await res.text() };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  // 1. Webhook verification handshake (what Meta does when you save the webhook).
  const verify = await get(
    '/webhook?hub.mode=subscribe&hub.verify_token=change-me-verify-token&hub.challenge=TEST123'
  );
  check('Webhook verification returns the challenge', verify.status === 200 && verify.body === 'TEST123', `got: ${verify.body}`);

  // 2. Customer comments QUOTE on the QUOTE video (media 18000000000000001).
  const comment = await post('/webhook', {
    object: 'instagram',
    entry: [{
      changes: [{
        field: 'comments',
        value: {
          id: 'comment-1',
          text: 'QUOTE',
          from: { id: 'customer-123' },
          media: { id: '18000000000000001' },
        },
      }],
    }],
  });
  check('Comment webhook accepted', comment === 'EVENT_RECEIVED', `got: ${comment}`);
  await new Promise((r) => setTimeout(r, 200));

  // 3. Customer answers question 1 by DM.
  const q1 = await post('/test/message', { senderId: 'customer-123', text: 'Life insurance' });
  check('Question 1 answered, question 2 asked', q1.action === 'asked' && q1.question === 2, JSON.stringify(q1));

  // 4. Customer answers question 2 by DM.
  const q2 = await post('/test/message', { senderId: 'customer-123', text: 'No, never had it before' });
  check('Question 2 answered, time slots offered', q2.action === 'offered_slots' && Array.isArray(q2.slots) && q2.slots.length > 0, `${(q2.slots || []).length} slots offered`);

  // 5. Customer picks slot 1.
  const booked = await post('/test/message', { senderId: 'customer-123', text: '1' });
  check('Meeting booked', booked.action === 'booked', JSON.stringify(booked));

  // 6. The booking is on the (mock) calendar.
  const bookings = await get('/bookings');
  const events = JSON.parse(bookings.body).events || [];
  const ours = events.find((e) => e.summary.includes('Free Quote Review Call'));
  check('Booking appears on calendar', Boolean(ours), ours ? `${ours.summary} at ${ours.start}` : 'not found');

  // 7. Wrong trigger word on the QUOTE video (AUTO belongs to another video).
  const wrong = await post('/test/comment', {
    commentId: 'comment-2', commenterId: 'customer-999',
    mediaId: '18000000000000001', text: 'AUTO',
  });
  check('Wrong word redirects to the right video', wrong.action === 'redirected', JSON.stringify(wrong));

  // 8. Human handoff: a customer who is upset.
  await post('/test/comment', {
    commentId: 'comment-3', commenterId: 'customer-555',
    mediaId: '18000000000000002', text: 'AUTO',
  });
  const handoff = await post('/test/message', { senderId: 'customer-555', text: 'I want a refund, this is a scam' });
  check('Off-script message hands off to a human', handoff.action === 'handed_off', JSON.stringify(handoff));

  // 9. Activity log recorded everything.
  const activity = await get('/activity');
  const entries = JSON.parse(activity.body).entries || [];
  const hasBooking = entries.some((e) => e.event === 'meeting_booked');
  const hasHandoff = entries.some((e) => e.event === 'handoff');
  check('Activity log has the booking and the handoff', hasBooking && hasHandoff, `${entries.length} entries logged`);

  console.log('\n--- Activity log (latest first, top 8) ---');
  entries.slice(0, 8).forEach((e) => console.log(`  ${e.time}  ${e.event}`));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(', '));
  server.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Simulation crashed:', e);
  process.exit(1);
});

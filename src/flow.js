// The conversation flow: one small state machine per customer.
// Stages: greeting -> question 1 -> question 2 -> offer slots -> booked
//        (or handed_off if the customer goes off-script)
const fs = require('fs');
const path = require('path');
const { log } = require('./log');
const { sendDM, sendPrivateReply } = require('./instagram');
const calendar = require('./calendar');
const { aiReply, scriptedReply } = require('./llm');

const triggers = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'triggers.json'), 'utf8')
);

const HANDOFF_KEYWORDS = (triggers.handoffKeywords || [
  'complaint',
  'refund',
  'cancel',
  'human',
  'manager',
  'lawyer',
  'scam',
]).map((w) => w.toLowerCase());

// In-memory conversations, keyed by the customer's Instagram user id.
// (For a big deployment this would move to a database; in-memory is fine to start.)
const conversations = new Map();

function findVideoByMediaId(mediaId) {
  return triggers.videos.find((v) => String(v.media_id) === String(mediaId));
}

function findVideoByTrigger(word) {
  const w = String(word || '').trim().toUpperCase();
  return triggers.videos.find((v) => v.trigger.toUpperCase() === w);
}

function needsHandoff(text) {
  const lower = String(text || '').toLowerCase();
  return HANDOFF_KEYWORDS.some((k) => lower.includes(k));
}

function formatSlot(slot, index) {
  const day = slot.start.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: calendar.TIMEZONE,
  });
  const time = slot.start.toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: calendar.TIMEZONE,
  });
  return `${index + 1}. ${day} at ${time}`;
}

// A comment matched a trigger word: start the conversation with a private-reply DM.
async function handleComment({ commentId, commenterId, mediaId, text }) {
  const video = findVideoByMediaId(mediaId);
  if (!video) {
    log('comment_ignored_no_video', { mediaId, text });
    return { action: 'ignored', reason: 'no video config for this media id' };
  }
  const trigger = findVideoByTrigger(text);
  if (!trigger || trigger.media_id !== video.media_id) {
    // Either no trigger word at all, or the word belongs to a different video.
    const other = findVideoByTrigger(text);
    log('comment_wrong_trigger', {
      mediaId,
      text,
      belongsToVideo: other ? other.meetingType : null,
    });
    if (other) {
      await sendPrivateReply(
        commentId,
        `Hi! That word is for our video about ${other.meetingType.toLowerCase()}. ` +
          `Comment ${other.trigger} on that video and I'll help you there. ` +
          `Or reply here and I can still help you book a call.`
      );
      return { action: 'redirected', toVideo: other.meetingType };
    }
    return { action: 'ignored', reason: 'no trigger word in comment' };
  }

  const firstMessage =
    `Hi! Thanks for commenting ${video.trigger} — happy to help. ` +
    `I'll ask you two quick questions, then we can book your ${video.meetingType.toLowerCase()}. ` +
    video.questions[0];

  conversations.set(String(commenterId), {
    userId: String(commenterId),
    video,
    stage: 'q1',
    answers: [],
    history: [{ role: 'assistant', text: firstMessage }],
    updatedAt: Date.now(),
  });

  await sendPrivateReply(commentId, firstMessage);
  log('conversation_started', {
    userId: commenterId,
    video: video.meetingType,
    trigger: video.trigger,
  });
  return { action: 'started', meetingType: video.meetingType };
}

// A DM arrived from a customer we are already talking to.
async function handleMessage({ senderId, text }) {
  const convo = conversations.get(String(senderId));
  if (!convo) {
    log('dm_ignored_no_conversation', { senderId, text });
    return { action: 'ignored', reason: 'no open conversation for this person' };
  }
  if (convo.stage === 'handed_off') {
    log('dm_after_handoff', { senderId, text });
    return { action: 'ignored', reason: 'already handed off to a human' };
  }
  if (convo.stage === 'booked') {
    await sendDM(
      senderId,
      'Your meeting is already booked — I sent you the details above. ' +
        'If you need to change the time, just let me know and I will get the agent for you.'
    );
    return { action: 'already_booked' };
  }

  convo.history.push({ role: 'user', text });

  if (needsHandoff(text)) {
    convo.stage = 'handed_off';
    convo.updatedAt = Date.now();
    await sendDM(
      senderId,
      "No problem — I'll get the agent to reply to you personally about that. " +
        'They will message you back as soon as they can.'
    );
    log('handoff', {
      userId: senderId,
      reason: 'off-script message',
      text,
      answers: convo.answers,
      video: convo.video.meetingType,
    });
    return { action: 'handed_off' };
  }

  const video = convo.video;

  if (convo.stage === 'q1') {
    convo.answers.push(text);
    convo.stage = 'q2';
    const reply = video.questions[1];
    convo.history.push({ role: 'assistant', text: reply });
    await sendDM(senderId, reply);
    return { action: 'asked', question: 2 };
  }

  if (convo.stage === 'q2') {
    convo.answers.push(text);
    convo.stage = 'slots';
    const slots = await calendar.freeSlots(video.durationMinutes, 4);
    convo.slots = slots;
    const list = slots.map((s, i) => formatSlot(s, i)).join('\n');
    const reply =
      `${scriptedReply('thanks')} Here are some open times for your ` +
      `${video.meetingType.toLowerCase()} (${video.durationMinutes} minutes):\n${list}\n\n` +
      'Just reply with the number of the time that works best for you.';
    convo.history.push({ role: 'assistant', text: reply });
    await sendDM(senderId, reply);
    return { action: 'offered_slots', slots: slots.map((s) => s.start.toISOString()) };
  }

  if (convo.stage === 'slots') {
    const choice = parseInt(String(text).trim(), 10);
    const slot = convo.slots && convo.slots[choice - 1];
    if (!slot) {
      const reply =
        "Sorry, I didn't catch that — please reply with just the number of the time " +
        'you would like (1, 2, 3 or 4).';
      await sendDM(senderId, reply);
      return { action: 'slot_not_understood' };
    }
    const event = await calendar.book({
      summary: `${video.meetingType} — Instagram booking`,
      description:
        `Booked by the Instagram booking agent.\n` +
        `Video: ${video.meetingType} (trigger ${video.trigger})\n` +
        `Answers:\n` +
        video.questions.map((q, i) => `  ${q}\n  -> ${convo.answers[i] || ''}`).join('\n'),
      start: slot.start,
      end: slot.end,
    });
    convo.stage = 'booked';
    convo.updatedAt = Date.now();
    const when = formatSlot(slot, 0).replace(/^\d+\.\s*/, '').replace(/\.$/, '');
    const reply =
      `${scriptedReply('confirm')} Your ${video.meetingType.toLowerCase()} is booked for ` +
      `${when}. ` +
      `The agent will talk to you then. If you need to change it, just reply here.`;
    convo.history.push({ role: 'assistant', text: reply });
    await sendDM(senderId, reply);
    log('meeting_booked', {
      userId: senderId,
      meetingType: video.meetingType,
      start: slot.start.toISOString(),
      answers: convo.answers,
      eventId: event.id,
    });
    return { action: 'booked', start: slot.start.toISOString(), eventId: event.id };
  }

  return { action: 'ignored' };
}

function getConversation(userId) {
  return conversations.get(String(userId));
}

module.exports = {
  handleComment,
  handleMessage,
  getConversation,
  findVideoByMediaId,
  findVideoByTrigger,
  conversations,
};

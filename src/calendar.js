// Calendar: real Google Calendar when credentials are set, otherwise a
// built-in mock calendar that keeps bookings in memory. The rest of the
// code never knows which one is running — both have the same functions.
const { log } = require('./log');

const TIMEZONE = process.env.TIMEZONE || 'America/Regina';

// ---------- Timezone helpers ----------
// The server may run in UTC (Render does), but slots must be 9am-5pm in the
// agent's own timezone. These helpers convert a wall-clock time in TIMEZONE
// to a real UTC instant.
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUTC - date.getTime();
}

// A wall-clock time (year/month/day/hour/minute) in TIMEZONE, as a Date.
function zonedTime({ year, month, day, hour, minute }) {
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMs(new Date(utc), TIMEZONE);
  return new Date(utc - offset);
}

// The calendar date (in TIMEZONE) that is `daysAhead` days from now.
function zonedDateParts(daysAhead) {
  const now = new Date(Date.now() + daysAhead * 24 * 60 * 60000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// All candidate 9am-5pm slot starts (in TIMEZONE) for the next 3 days.
function candidateSlotStarts(durationMinutes) {
  const starts = [];
  for (let d = 1; d <= 3; d++) {
    const { year, month, day } = zonedDateParts(d);
    for (let h = 9; h < 17; h++) {
      for (const m of [0, 30]) {
        starts.push(zonedTime({ year, month, day, hour: h, minute: m }));
      }
    }
  }
  return starts;
}

// ---------- Mock calendar (used for testing, no Google account needed) ----------
const mockEvents = [];
let mockSeeded = false;

function seedMock() {
  if (mockSeeded) return;
  mockSeeded = true;
  // Pretend tomorrow 2pm (agent's timezone) is already taken, so the demo shows a busy slot.
  const { year, month, day } = zonedDateParts(1);
  const start = zonedTime({ year, month, day, hour: 14, minute: 0 });
  mockEvents.push({
    id: 'mock-seed-1',
    summary: 'Existing appointment (example)',
    start: start.toISOString(),
    end: new Date(start.getTime() + 30 * 60000).toISOString(),
  });
}

// Offer the next few open slots: tomorrow and the next days, 9am-5pm
// in the agent's timezone, skipping anything already booked.
function mockFreeSlots(durationMinutes = 30, count = 4) {
  seedMock();
  const slots = [];
  for (const start of candidateSlotStarts(durationMinutes)) {
    if (slots.length >= count) break;
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const clash = mockEvents.some(
      (e) => new Date(e.start) < end && new Date(e.end) > start
    );
    if (!clash) slots.push({ start, end });
  }
  return slots;
}

function mockBook({ summary, description, start, end }) {
  seedMock();
  const event = {
    id: 'mock-' + Date.now(),
    summary,
    description: description || '',
    start: start.toISOString(),
    end: end.toISOString(),
  };
  mockEvents.push(event);
  log('calendar_booked_mock', { summary, start: event.start });
  return event;
}

// ---------- Real Google Calendar (service account, via plain REST) ----------
const useRealCalendar = Boolean(
  process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
);

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getGoogleAccessToken() {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: process.env.GOOGLE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = base64url(
    signer.sign(process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'))
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Google token failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function googleRequest(path, method, body) {
  const token = await getGoogleAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Google Calendar failed: ' + JSON.stringify(data));
  return data;
}

async function realFreeSlots(durationMinutes = 30, count = 4) {
  const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');
  const now = new Date();
  const timeMax = new Date(now.getTime() + 3 * 24 * 60 * 60000);
  const busy = await googleRequest(
    `/calendars/${calId}/events?timeMin=${now.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime`,
    'GET'
  );
  const busyRanges = (busy.items || []).map((e) => ({
    start: new Date(e.start.dateTime || e.start.date),
    end: new Date(e.end.dateTime || e.end.date),
  }));
  const slots = [];
  for (const start of candidateSlotStarts(durationMinutes)) {
    if (slots.length >= count) break;
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const clash = busyRanges.some((b) => b.start < end && b.end > start);
    if (!clash) slots.push({ start, end });
  }
  return slots;
}

async function realBook({ summary, description, start, end }) {
  const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');
  const event = await googleRequest(`/calendars/${calId}/events`, 'POST', {
    summary,
    description,
    start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
  });
  log('calendar_booked_google', { summary, start: start.toISOString(), id: event.id });
  return event;
}

// ---------- Public interface (same for mock and real) ----------
async function freeSlots(durationMinutes, count) {
  return useRealCalendar
    ? realFreeSlots(durationMinutes, count)
    : mockFreeSlots(durationMinutes, count);
}

async function book(event) {
  return useRealCalendar ? realBook(event) : mockBook(event);
}

function listMockEvents() {
  seedMock();
  return mockEvents;
}

module.exports = {
  freeSlots,
  book,
  listMockEvents,
  mode: useRealCalendar ? 'google' : 'mock',
  TIMEZONE,
};

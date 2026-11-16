// Simple activity log: every thing the agent does is written to a file
// (logs/activity.log) and kept in memory so it can be viewed at /activity.
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.log');
const entries = [];

function log(event, details) {
  const entry = { time: new Date().toISOString(), event, ...details };
  entries.push(entry);
  if (entries.length > 500) entries.shift();
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Logging must never crash the agent.
    console.error('Could not write log file:', e.message);
  }
  console.log(`[${entry.time}] ${event}`, details ? JSON.stringify(details) : '');
  return entry;
}

function getEntries() {
  return entries.slice().reverse();
}

module.exports = { log, getEntries };

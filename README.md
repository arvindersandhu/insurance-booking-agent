# Instagram Booking Agent — plain-language guide

This is the real program that runs the insurance agent's Instagram bookings.
A customer comments a trigger word (like QUOTE) on a video, the program
messages them, asks two questions, and books a meeting on the calendar.
If the customer says something the program can't handle, it stops and
tells the human to take over.

You do **not** need to know how to code to use this. You only need
accounts and passwords. The building is already done.

## What you need (accounts)

1. **An Instagram Business account** for the insurance agent.
   (In Instagram: Settings → Account type → Switch to professional account →
   Business. It must also be connected to a Facebook Page.)
2. **A Meta developer account** — free, at developers.facebook.com.
   This is where you tell Meta "send my Instagram comments and messages
   to my program". The program's webhook address goes there.
3. **A Google account** with a calendar — only if you want real bookings
   on a real calendar. Without it, the program uses a practice calendar
   built in, which is fine for testing.
4. **An OpenAI account** — only if you want the replies written by AI.
   Without it, the program uses polite pre-written replies, which work fine.

Nothing here costs money to start: Meta's API is free, the test mode is
free, and the hosting below has a free tier.

## How it works, in plain words

- The agent posts a video that says "Comment QUOTE".
- A customer comments QUOTE. Meta sends that comment to this program.
- The program checks its list (`config/triggers.json`): QUOTE belongs to
  the Free Quote Review Call video. It sends the customer a private DM.
- The DM asks the two questions written in that list, one at a time.
- Then it offers four open meeting times from the calendar. The customer
  replies "1", "2", "3" or "4".
- The program books the meeting, sends a confirmation DM, and writes
  everything it did in the activity log.
- Every video can have its **own** trigger word. To change a word, edit
  `config/triggers.json` (the `trigger` line for that video) and restart
  the program. No rebuilding needed.
- If a customer writes something angry, asks for a refund, or asks for a
  human, the program stops replying and writes "handoff" in the log so
  the agent can take over personally.

## Test it on your own computer first (no accounts needed)

1. Install Node.js (version 18 or newer) from nodejs.org — click the
   big green download button and install it like any other program.
2. Open a terminal/command window in this folder and run:
   ```
   npm install
   npm test
   ```
   This pretends to be a customer: it comments QUOTE, answers both
   questions, picks a time, and books the meeting — all on the practice
   calendar. It prints PASS or FAIL for each step. If all say PASS,
   the program works.
3. To run the server yourself and poke at it:
   ```
   npm start
   ```
   Then open http://localhost:3000/health in a browser (it should say
   `"ok": true`), and http://localhost:3000/activity to see the log.

## Put it on the internet for free (Render free tier)

Meta can only send Instagram events to a server that is on the internet,
so for real use the program must be hosted. Render's free tier is enough
to start.

1. Put this folder on GitHub (free account). You can do this in your
   browser: create a repository, then drag this whole folder into it.
2. Go to render.com, sign up free, click **New → Blueprint**,
   connect your GitHub repository. (This folder has a `render.yaml`
   file, so Render already knows the build and start commands. If you
   prefer to set it up by hand instead, use **New → Web Service** and
   the commands in step 3.)
3. If setting up by hand, Render asks for a build command and a start command:
   - Build command: `npm install`
   - Start command: `npm start`
4. In Render, open the **Environment** tab and add your secrets
   (copy them from `.env.example` — never paste real secrets anywhere
   else):
   - `META_VERIFY_TOKEN` — invent a word, e.g. `my-secret-word-123`
   - `IG_PAGE_ACCESS_TOKEN` — from your Meta developer app
   - `IG_USER_ID` — your Instagram Business account ID
   - `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`
     — only for a real calendar; skip these to use the practice calendar
   - `OPENAI_API_KEY` — only for AI replies; skip to use pre-written replies
   - `TIMEZONE` — e.g. `America/Regina`
5. Render gives you an address like
   `https://instagram-booking-agent.onrender.com`. Your webhook URL is
   that address plus `/webhook`.

## Connect it to Instagram (Meta developer dashboard)

1. At developers.facebook.com, create an app (type: Business).
2. Add the **Instagram** product, then go to **Webhooks** in the left menu.
3. Add a subscription for **Instagram**, with:
   - Callback URL: your Render address + `/webhook`
   - Verify token: the exact same word you put in `META_VERIFY_TOKEN`
   - Subscribe to: `comments` and `messages`
4. Meta will call your server to check it — if the word matches, it
   turns green. That is the whole connection.
5. In your Instagram app settings, make sure the account is a Business
   account and connected to the Facebook Page used by the Meta app.
6. Test it for real: post a test video, comment the trigger word from a
   different account, and watch the DM arrive and the booking appear.

## Change the trigger words or questions

Open `config/triggers.json` in any text editor. Each video has:
- `media_id` — the Instagram ID of the video (you get this from Meta's
  Graph API Explorer, or it appears in the activity log when someone comments)
- `trigger` — the word customers comment (QUOTE, AUTO, LIFE…)
- `meetingType` — the name of the meeting that gets booked
- `durationMinutes` — how long the meeting is
- `questions` — the two questions the agent asks, in order

Save the file and restart the program (on Render: click **Manual Deploy**).

## Where to see what the agent did

- On your computer: the file `logs/activity.log`
- On the server: open `https://your-address.onrender.com/activity`
- Bookings on the practice calendar: `https://your-address.onrender.com/bookings`

## What is NOT done yet (needs real accounts)

- No real Meta access token or Instagram account is connected yet, so
  right now it runs in **dry-run mode**: it logs the DMs it *would*
  send instead of sending them.
- No real Google Calendar is connected yet, so bookings go to the
  practice calendar. Add the Google secrets above to use a real one.
- No AI key is set yet, so replies are pre-written. Add
  `OPENAI_API_KEY` to switch on AI-written replies.

## Safety notes

- Secrets live only in the `.env` file (on your computer) or in Render's
  Environment tab (on the server). They are never written in the code.
  The `.env` file is on the ignore list and will not be uploaded to GitHub.
- The program only replies to people who comment a trigger word or who
  are already in a conversation. It never messages strangers.
- It never asks for, or stores, passwords, bank details, or health
  information. If a customer sends sensitive information, it hands off
  to the human.

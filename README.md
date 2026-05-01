# AutoScroller

AutoScroller is a local Node.js application that controls a Playwright browser and automatically moves through **YouTube Shorts** or **Instagram Reels**. It includes a browser-based dashboard for choosing the platform, starting and stopping the bot, changing fallback timing, and watching live session stats.

The current version uses **smart video-end detection**. It does not simply scroll every N seconds. Instead, it tries to find the active `<video>` element on the page, reads its playback state, and scrolls when the video is complete or nearly complete.

## Current Project State

- The app is a Node.js project, not a Java project.
- The dashboard runs locally at `http://localhost:3000`.
- The dashboard can be opened in Firefox, Chrome, Edge, or another regular browser.
- The automated viewing window is always Playwright Chromium.
- The app supports YouTube Shorts and Instagram Reels.
- Scrolling is controlled from the dashboard through a WebSocket connection.
- Login/session data is stored in `.browser-data/<platform>` so accounts can stay logged in between runs.
- The Stop flow has been hardened so the dashboard returns to idle immediately and Playwright browser shutdown has a timeout.

## Feature Summary

- **Smart scroll mode**: watches the current video and scrolls when it ends.
- **Near-end detection**: scrolls when the video is essentially finished, even if the browser does not fire a clean ended state.
- **Fallback max wait**: scrolls after a user-defined maximum wait if video progress cannot be read.
- **Dual platform selection**: YouTube Shorts or Instagram Reels.
- **Dashboard controls**: Start, Pause/Resume, Skip, Stop.
- **Live session stats**: elapsed time, scroll count, current state, current platform.
- **Activity log**: WebSocket and bot activity appears in the dashboard.
- **Persistent browser sessions**: Chromium profile data is reused per platform.
- **Local-only server**: Express serves the dashboard and WebSocket control channel from your machine.

## Tech Stack

- **Runtime**: Node.js
- **Server**: Express
- **Realtime control**: `ws` WebSocket server
- **Automation**: Playwright Chromium
- **Frontend**: Vanilla HTML, CSS, and JavaScript
- **Module system**: CommonJS

## Project Structure

```text
autoscroller/
  README.md
  package.json
  package-lock.json
  server.js
  autoscroller.js
  .gitignore
  public/
    index.html
    style.css
    app.js
  node_modules/
  .browser-data/        created at runtime, ignored by git if configured
```

## Important Files

### `server.js`

This is the backend entry point.

Responsibilities:

- Creates an Express app.
- Serves `public/` as static files.
- Creates an HTTP server.
- Creates a WebSocket server using `ws`.
- Tracks the current `AutoScroller` instance.
- Receives dashboard commands:
  - `start`
  - `stop`
  - `pause`
  - `resume`
  - `skip`
  - `set_interval`
- Broadcasts status and log messages to all connected dashboard clients.
- Handles `SIGINT` and `SIGTERM` shutdown.

The server listens on:

```text
http://localhost:3000
```

You can override the port with:

```bash
PORT=4000 npm start
```

On PowerShell:

```powershell
$env:PORT=4000
npm start
```

### `autoscroller.js`

This contains the `AutoScroller` class and all Playwright automation logic.

Main responsibilities:

- Launches a persistent Chromium context.
- Opens YouTube Shorts or Instagram Reels.
- Handles basic Instagram login waiting.
- Attempts to dismiss YouTube consent UI.
- Opens the first short/reel if needed.
- Watches the active video.
- Scrolls to the next video when playback ends.
- Provides pause, resume, skip, interval/fallback update, and stop behavior.

Important methods:

- `start()`: launches Chromium, navigates to the selected platform, starts smart watching.
- `waitForLogin()`: waits for Instagram login to complete.
- `clickFirstVideo()`: tries to open the first visible short/reel.
- `startSmartScrollLoop()`: polls video state and decides when to scroll.
- `getActiveVideoState()`: runs in the browser page and reads active video progress.
- `scrollNext(reason)`: sends the down-arrow/scroll action and increments scroll count.
- `pause()`: pauses the smart watcher state.
- `resume()`: resumes watching.
- `setInterval(newInterval)`: updates the fallback max wait.
- `stop()`: stops timers and closes Chromium with a timeout.

### `public/index.html`

This is the dashboard layout.

It contains:

- Header and connection badge.
- Platform selector.
- Fallback Max Wait slider.
- Start, Pause, Skip, Stop controls.
- Live stats cards.
- Activity log.

### `public/app.js`

This is the dashboard client script.

Responsibilities:

- Connects to the backend WebSocket.
- Sends user commands to the server.
- Receives status and log events.
- Updates the dashboard state.
- Enables/disables buttons depending on bot state.
- Handles slider changes.
- Handles Pause/Resume button switching.

### `public/style.css`

This defines the dashboard styling.

The UI is a dark, compact control panel with:

- Glass-style panels.
- Animated background particles.
- Platform cards.
- Responsive layout.
- Button states.
- Live stat cards.
- Activity log styling.

## Installation

Install dependencies:

```bash
npm install
```

Install Playwright Chromium:

```bash
npx playwright install chromium
```

Start the app:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Available Scripts

```bash
npm start
```

Runs:

```bash
node server.js
```

```bash
npm run dev
```

Also runs:

```bash
node server.js
```

There is currently no separate development watcher, test runner, or build step.

## Runtime Flow

1. You run `npm start`.
2. `server.js` starts an Express server on port `3000`.
3. You open `http://localhost:3000`.
4. `public/app.js` creates a WebSocket connection to the server.
5. The dashboard shows `Connected`.
6. You choose YouTube Shorts or Instagram Reels.
7. You set a Fallback Max Wait.
8. You click Start.
9. The dashboard sends a `start` message over WebSocket.
10. The server creates a new `AutoScroller`.
11. Playwright launches Chromium using a persistent profile directory.
12. Chromium navigates to the selected platform.
13. The bot enters `running` state.
14. The smart watcher reads the active video state.
15. When the video ends or nearly ends, the bot scrolls to the next video.
16. Status updates and logs are broadcast back to the dashboard.

## Dashboard Controls

### Platform Cards

- **YouTube Shorts** opens `https://www.youtube.com/shorts`.
- **Instagram Reels** opens `https://www.instagram.com/reels/`.

The selected platform cannot be changed while the bot is running. Stop the bot first.

### Fallback Max Wait

This is not the normal scroll interval.

It is the maximum time the bot will wait before forcing a skip when it cannot reliably read the active video.

Fallback can trigger when:

- No usable `<video>` element is found.
- The video duration is unavailable.
- The video is paused or blocked.
- A cookie/login/consent overlay prevents normal playback.
- Platform markup changes confuse the active-video detector.

The current slider range is:

```text
2 seconds to 30 seconds
```

### Start

Starts a new bot session.

If a session is already running, the server attempts to stop the previous session before starting the new one.

### Pause / Resume

Pause stops the smart watcher from advancing videos.

Resume restarts smart watching and resets the current video tracking state.

### Skip

Immediately scrolls to the next video.

This calls `scrollNext()` manually and logs the reason as `manual skip`.

### Stop

Stops the smart watcher, closes the Playwright Chromium browser, clears the current bot instance, and returns the dashboard to idle.

The code now clears the dashboard state before waiting for browser cleanup, so the UI should not appear stuck if Chromium takes a moment to close.

## Smart Scroll Logic

The smart watcher runs every 400 milliseconds while the bot is in `running` state.

It evaluates the page and gathers all `<video>` elements.

To choose the active video, it scores visible videos based on:

- Visibility inside the viewport.
- Visible area.
- Distance from the center of the viewport.
- Whether the video is currently playing.

For the selected video it reads:

- `currentTime`
- `duration`
- `ended`
- `paused`
- calculated `remaining`
- calculated `progress`

The bot scrolls when:

- `video.ended` is true.
- Remaining time is less than or equal to about `0.35` seconds.
- Progress is greater than or equal to about `98.5%`.
- The video stays near the end for a short grace period.
- The fallback max wait is reached.

This approach is usually more reliable than scraping the visual progress bar because the progress bar UI can change often, while the underlying HTML video state is a browser-native API.

## Platform Details

### YouTube Shorts

Navigation target:

```text
https://www.youtube.com/shorts
```

Scroll behavior:

- Sends `ArrowDown`.

Startup behavior:

- Tries to dismiss an `Accept all` consent button.
- Tries an alternate YouTube consent button selector.
- Tries to click the first visible short link if needed.

### Instagram Reels

Navigation target:

```text
https://www.instagram.com/reels/
```

Scroll behavior:

- Sends `ArrowDown`.
- Also tries a DOM scroll fallback on the page/container.

Login behavior:

- If the login form is detected, the bot enters `login` state.
- You must log in manually in the Chromium window.
- The bot waits up to 5 minutes.
- After login, it navigates or returns to Reels and starts watching.

## Browser Profiles and Session Storage

The app uses Playwright's `launchPersistentContext()`.

Profile data is stored here:

```text
.browser-data/youtube
.browser-data/instagram
```

This allows:

- YouTube consent state to persist.
- Instagram login to persist.
- Browser cookies/local storage to survive between runs.

If login state gets corrupted or you want a clean browser profile, stop the app and delete the relevant folder inside `.browser-data`.

## WebSocket Messages

The dashboard sends JSON messages to the server.

### Start

```json
{
  "type": "start",
  "platform": "youtube",
  "interval": 5
}
```

`platform` can be:

```text
youtube
instagram
```

`interval` is currently used as fallback max wait seconds.

### Stop

```json
{
  "type": "stop"
}
```

### Pause

```json
{
  "type": "pause"
}
```

### Resume

```json
{
  "type": "resume"
}
```

### Skip

```json
{
  "type": "skip"
}
```

### Set Fallback Max Wait

```json
{
  "type": "set_interval",
  "interval": 10
}
```

The old name `set_interval` remains in the code, but functionally this now means "set fallback max wait."

## Status Object

The server broadcasts status objects like this:

```json
{
  "state": "running",
  "platform": "youtube",
  "scrollCount": 3,
  "sessionTime": 42,
  "interval": 5
}
```

Fields:

- `state`: current bot state.
- `platform`: `youtube`, `instagram`, or `null`.
- `scrollCount`: number of scrolls in the current session.
- `sessionTime`: seconds since the session started.
- `interval`: fallback max wait in seconds.

Possible states:

```text
idle
starting
login
running
paused
stopped
```

## Logs

Logs appear in two places:

- Terminal running `npm start`.
- Dashboard Activity Log.

Examples:

```text
[WS] Client connected
[WS] Received: start
[AutoScroller] Starting YouTube Shorts scroller...
[AutoScroller] Smart mode enabled. Scrolling when the active video ends; fallback max wait is 5s.
[AutoScroller] Watching video (18s) until completion...
[AutoScroller] Scrolled to video #1 (video ended).
```

## Stopping the App

Preferred ways:

1. Click **Stop** in the dashboard.
2. Press `Ctrl+C` in the terminal running `npm start`.

Emergency stop on PowerShell:

```powershell
Get-Process node,chrome -ErrorAction SilentlyContinue | Stop-Process -Force
```

This force-stops the Node server and Chromium windows.

If you only want to stop a known server process:

```powershell
Stop-Process -Id <PID>
```

## Troubleshooting

### Dashboard says Disconnected

The Node server is not running or crashed.

Fix:

```bash
npm start
```

Then reload:

```text
http://localhost:3000
```

### Port 3000 is already in use

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

Stop it if appropriate:

```powershell
Stop-Process -Id <PID>
```

Or run on another port:

```powershell
$env:PORT=4000
npm start
```

### Clicking Start does nothing

Check:

- Dashboard shows `Connected`.
- Terminal shows `[WS] Received: start`.
- Playwright Chromium is installed.
- No browser/login dialog is blocking the page.

Install Chromium if needed:

```bash
npx playwright install chromium
```

### Chromium opens but does not scroll

Possible causes:

- Video is paused.
- Login is required.
- Cookie or consent dialog is blocking playback.
- YouTube/Instagram changed their DOM.
- The active video is not exposed as a normal `<video>` element.

Try:

- Manually start playback once.
- Accept cookies/consent.
- Log in if prompted.
- Press Skip from the dashboard.
- Increase Fallback Max Wait.
- Restart the bot.

### Stop button appears stuck

The current code clears the dashboard state immediately and limits browser close waiting to about 3 seconds.

If something still refuses to stop, use:

```powershell
Get-Process node,chrome -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Instagram login keeps appearing

The persistent profile may not be saving correctly, or the session may be invalid.

Try:

1. Stop the app.
2. Delete `.browser-data/instagram`.
3. Start again.
4. Log in manually in the Playwright Chromium window.

### YouTube consent keeps appearing

Try accepting consent manually in the Playwright Chromium window. The persistent profile should remember it on later runs.

## Known Limitations

- YouTube and Instagram are not stable automation targets. Their markup, consent UI, keyboard behavior, and anti-automation behavior may change.
- Instagram may require manual login.
- Autoplay restrictions may require one manual interaction in Chromium.
- The visual progress bar is not scraped directly; the app uses the underlying HTML video API.
- If a video loops instead of ending, the near-end and progress checks are intended to advance anyway.
- The fallback max wait may skip long videos early if set too low.
- Running multiple dashboard tabs can create multiple WebSocket clients, though they all control the same backend bot.
- This project has no automated test suite yet.

## Development Notes

Useful syntax checks:

```bash
node --check server.js
node --check autoscroller.js
node --check public/app.js
```

Search code:

```bash
rg "startSmartScrollLoop"
rg "getActiveVideoState"
rg "set_interval"
```

Main implementation areas:

- Backend command routing: `server.js`
- Browser automation: `autoscroller.js`
- Dashboard behavior: `public/app.js`
- Dashboard markup: `public/index.html`
- Dashboard styling: `public/style.css`

## Configuration

Currently configurable from the dashboard:

- Platform: YouTube or Instagram.
- Fallback Max Wait: 2 to 30 seconds.

Currently configurable by environment:

- `PORT`: server port.

Example:

```powershell
$env:PORT=4000
npm start
```

## Responsible Use

This tool automates interaction with third-party websites. Use it carefully and understand that YouTube and Instagram may have terms, rate limits, anti-automation systems, or account restrictions. The project is intended as a local automation experiment and control-dashboard prototype.

## Future Improvement Ideas

- Add a true mode selector: smart mode vs fixed interval mode.
- Rename `interval` and `set_interval` internally to `fallbackMaxWait`.
- Add a health endpoint such as `/health`.
- Add automated tests for WebSocket command handling.
- Add a visible "Stopping..." state.
- Add per-platform selector diagnostics.
- Add a dashboard indicator for active video duration/progress.
- Add a safer process manager script for start/stop on Windows.
- Add configurable headless mode.
- Add browser selection options if Firefox automation is desired later.

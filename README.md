# AutoScroller - Smart Shorts/Reels Scroller

Auto-scroll through **YouTube Shorts** from a local control dashboard.

Instagram Reels is parked for now while the project focuses on making the YouTube Shorts bot solid first.

## Features

- **Smart video-end detection** - watches the active video and scrolls when it ends.
- **Stuck timeout** - guardrail for ads, paused videos, hidden videos, or platform markup changes.
- **YouTube-first focus** - Instagram Reels notes are preserved in code comments for a later phase.
- **Full controls** - Start, Pause, Resume, Skip, Stop.
- **Live stats** - Session timer, scroll counter, status tracking.
- **Activity log** - Real-time event feed.
- **Persistent sessions** - Login once; browser profile data is reused.
- **Dark dashboard UI** - Responsive local control panel.

## Quick Start

```bash
npm install
npx playwright install chromium
npm start
```

Then open:

```text
http://localhost:3000
```

## How It Works

1. Open the dashboard at `http://localhost:3000`.
2. Keep **YouTube Shorts** selected.
3. Set **Stuck Timeout**. This is not the normal scroll interval; it is only used when video progress cannot be read or progress stops moving.
4. Click **Start**. A Playwright Chromium window opens automatically.
5. The app detects the active `<video>` element and scrolls when the video is complete or nearly complete.
6. Use **Pause**, **Skip**, or **Stop** from the dashboard.

## Notes

- The dashboard can be opened in Firefox, Chrome, or another browser.
- The automated viewing window uses Playwright Chromium.
- YouTube changes its page structure often, so selectors may need future tuning.
- Instagram Reels is visible as a passive roadmap item, but it is disabled in this build.
- Emergency stop on PowerShell:

```powershell
Get-Process node,chrome -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Tech Stack

- **Backend**: Node.js, Express, WebSocket
- **Automation**: Playwright Chromium
- **Frontend**: Vanilla HTML, CSS, JavaScript

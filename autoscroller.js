const { chromium, firefox } = require('playwright');

// Supported browser options and their Playwright configuration
const BROWSER_OPTIONS = {
  chromium: { engine: 'chromium', channel: undefined, label: 'Chromium (bundled)' },
  chrome:   { engine: 'chromium', channel: 'chrome',  label: 'Google Chrome' },
  msedge:   { engine: 'chromium', channel: 'msedge',  label: 'Microsoft Edge' },
  firefox:  { engine: 'firefox',  channel: undefined, label: 'Firefox' },
};

class AutoScroller {
  constructor({ platform, interval, browserType, onStatusUpdate, onLog }) {
    this.platform = 'youtube';
    this.interval = interval; // stuck timeout in seconds
    this.browserType = browserType || 'chromium'; // 'chromium', 'chrome', 'msedge', 'firefox'
    this.onStatusUpdate = onStatusUpdate || (() => {});
    this.onLog = onLog || (() => {});

    this.browser = null;
    this.context = null;
    this.page = null;
    this.scrollCount = 0;
    this.state = 'idle'; // idle, starting, login, running, paused, stopped
    this.startTime = null;
    this.watchTimer = null;
    this.statusInterval = null;
    this.userDataDir = null;
    this.isScrolling = false;
    this.isStopping = false;
    this.videoWatch = {
      lastKey: null,
      startedAt: null,
      lastCurrentTime: null,
      lastSeekProgress: null,
      lastProgressAt: null,
      completedAt: null,
    };
  }

  getStatus() {
    return {
      state: this.state,
      platform: this.platform,
      scrollCount: this.scrollCount,
      sessionTime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      interval: this.interval,
      browserType: this.browserType,
    };
  }

  isRunning() {
    return ['starting', 'login', 'running', 'paused'].includes(this.state);
  }

  log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    this.onLog({ timestamp, message: msg });
    console.log(`[AutoScroller] ${msg}`);
  }

  emitStatus() {
    this.onStatusUpdate(this.getStatus());
  }

  async start() {
    try {
      this.state = 'starting';
      this.emitStatus();

      const browserOpt = BROWSER_OPTIONS[this.browserType] || BROWSER_OPTIONS.chromium;
      const engine = browserOpt.engine === 'firefox' ? firefox : chromium;

      this.log(`Starting YouTube Shorts scroller using ${browserOpt.label}...`);

      const path = require('path');
      this.userDataDir = path.join(__dirname, '.browser-data', `youtube-${this.browserType}`);

      const launchOptions = {
        headless: false,
        viewport: { width: 430, height: 932 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      };

      // Chromium-based browsers support args and channel
      if (browserOpt.engine === 'chromium') {
        launchOptions.args = [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
        ];
        if (browserOpt.channel) {
          launchOptions.channel = browserOpt.channel;
        }
      }

      // Firefox uses a different arg format; keep defaults
      if (browserOpt.engine === 'firefox') {
        launchOptions.firefoxUserPrefs = {
          'media.autoplay.default': 0, // allow autoplay
        };
      }

      this.browser = await engine.launchPersistentContext(this.userDataDir, launchOptions);

      this.page = this.browser.pages()[0] || await this.browser.newPage();

      const url = 'https://www.youtube.com/shorts';

      this.log(`Navigating to ${url}`);
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      try {
        const consentBtn = await this.page.$('button[aria-label="Accept all"]');
        if (consentBtn) {
          await consentBtn.click();
          await this.page.waitForTimeout(2000);
        }

        const rejectBtn = await this.page.$('tp-yt-paper-button.style-scope.ytd-consent-bump-v2-lightbox:last-child');
        if (rejectBtn) {
          await rejectBtn.click();
          await this.page.waitForTimeout(2000);
        }
      } catch (e) {
        // Consent dialog might not appear.
      }

      await this.clickFirstVideo();

      this.state = 'running';
      this.startTime = Date.now();
      this.scrollCount = 0;
      this.emitStatus();
      this.log('Auto-scrolling started.');
      this.startSmartScrollLoop();

      this.statusInterval = setInterval(() => this.emitStatus(), 1000);
    } catch (err) {
      this.log(`Error: ${err.message}`);
      this.state = 'idle';
      this.emitStatus();
      throw err;
    }
  }

  // Instagram is parked for later. Notes for the future Instagram pass:
  // - Navigate to https://www.instagram.com/reels/
  // - Detect login with input[name="username"].
  // - Wait up to 5 minutes for a logged-in state.
  // - Logged-in hints used previously: article, [role="main"] video, svg[aria-label="Reels"].
  // - First reel selectors used previously: a[href*="/reel/"], div._aagu video, article video.
  // - Scroll fallback used previously: ArrowDown plus container.scrollBy on div._aanv, section main, or documentElement.

  async clickFirstVideo() {
    try {
      const short = await this.page.$('ytd-rich-item-renderer a#thumbnail, a.shortsLockupViewModelHostEndpoint, ytd-reel-item-renderer a, a[href*="/shorts/"]');
      if (short) {
        await short.click();
        await this.page.waitForTimeout(2000);
        this.log('Opened first Short.');
      }
    } catch (e) {
      this.log('First video auto-click skipped; you may already be viewing content.');
    }
  }

  startSmartScrollLoop() {
    this.stopSmartScrollLoop();
    this.resetVideoWatch();
    this.log(`Smart mode enabled. Scrolling when the active video ends; stuck timeout is ${this.interval}s.`);

    this.watchTimer = setInterval(async () => {
      if (this.state !== 'running' || this.isScrolling) return;

      try {
        const video = await this.getActiveVideoState();
        const now = Date.now();

        if (!video || (!video.hasUsableDuration && video.seekProgress === null)) {
          if (!this.videoWatch.startedAt) this.videoWatch.startedAt = now;

          if (now - this.videoWatch.startedAt >= this.interval * 1000) {
            await this.scrollNext('stuck timeout: no readable active video');
          }
          return;
        }

        if (this.videoWatch.lastKey !== video.key) {
          this.videoWatch = {
            lastKey: video.key,
            startedAt: now,
            lastCurrentTime: video.currentTime,
            lastSeekProgress: video.seekProgress,
            lastProgressAt: now,
            completedAt: null,
          };
          this.log(`Watching video (${Math.round(video.duration)}s) until seek bar reaches 100%...`);
        }

        const lastCurrentTime = this.videoWatch.lastCurrentTime;
        const lastSeekProgress = this.videoWatch.lastSeekProgress;
        const videoProgressed = lastCurrentTime === null || video.currentTime > lastCurrentTime + 0.15;
        const seekProgressed = video.seekProgress !== null
          && (lastSeekProgress === null || video.seekProgress > lastSeekProgress + 0.002);
        const hasProgressed = videoProgressed || seekProgressed;

        if (hasProgressed) {
          this.videoWatch.lastCurrentTime = video.currentTime;
          this.videoWatch.lastSeekProgress = video.seekProgress;
          this.videoWatch.lastProgressAt = now;
        } else if (!this.videoWatch.lastProgressAt) {
          this.videoWatch.lastProgressAt = now;
        }

        if (video.paused && now - this.videoWatch.lastProgressAt >= this.interval * 1000) {
          await this.scrollNext('stuck timeout: video paused or blocked');
          return;
        }

        const completedBySeekBar = video.seekProgress !== null && video.seekProgress >= 0.9995;
        const completedByVideoApi = video.seekProgress === null
          && (video.ended || video.progress >= 0.9995 || video.remaining <= 0.05);

        if (completedBySeekBar || completedByVideoApi) {
          if (!this.videoWatch.completedAt) {
            this.videoWatch.completedAt = now;
            this.log(completedBySeekBar ? 'Seek bar reached 100%; waiting brief completion grace...' : 'Video API reports completion; waiting brief completion grace...');
          }

          const graceMs = this.getCompletionGraceMs(video.duration);
          if (now - this.videoWatch.completedAt >= graceMs) {
            await this.scrollNext(completedBySeekBar ? 'seek bar reached 100%' : 'video completed');
          }
          return;
        }

        this.videoWatch.completedAt = null;

        if (now - this.videoWatch.lastProgressAt >= this.interval * 1000) {
          await this.scrollNext('stuck timeout: video progress stopped');
        }
      } catch (err) {
        this.log(`Smart watch error: ${err.message}`);
      }
    }, 400);
  }

  stopSmartScrollLoop() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  resetVideoWatch() {
    this.videoWatch = {
      lastKey: null,
      startedAt: null,
      lastCurrentTime: null,
      lastSeekProgress: null,
      lastProgressAt: null,
      completedAt: null,
    };
  }

  getCompletionGraceMs(duration) {
    if (!duration || !Number.isFinite(duration)) return 250;
    return Math.min(Math.max(duration * 0.01 * 1000, 250), 1000);
  }

  async getActiveVideoState() {
    if (!this.page) return null;

    return this.page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      if (!videos.length) return null;

      const viewportCenterY = window.innerHeight / 2;
      const viewportCenterX = window.innerWidth / 2;

      const candidates = videos
        .map((video) => {
          const rect = video.getBoundingClientRect();
          const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
          const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
          const visibleArea = visibleWidth * visibleHeight;
          const area = Math.max(1, rect.width * rect.height);
          const visibleRatio = visibleArea / area;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distanceFromCenter = Math.hypot(centerX - viewportCenterX, centerY - viewportCenterY);
          const playingBonus = video.paused ? 0 : 100000;

          return { video, visibleArea, visibleRatio, distanceFromCenter, playingBonus };
        })
        .filter(({ visibleArea, visibleRatio }) => visibleArea > 2000 && visibleRatio > 0.2)
        .sort((a, b) => {
          const scoreA = a.playingBonus + a.visibleArea - a.distanceFromCenter;
          const scoreB = b.playingBonus + b.visibleArea - b.distanceFromCenter;
          return scoreB - scoreA;
        });

      const active = candidates[0] ? candidates[0].video : videos.find(video => !video.paused) || videos[0];
      const rect = active.getBoundingClientRect();
      const duration = Number.isFinite(active.duration) ? active.duration : 0;
      const currentTime = Number.isFinite(active.currentTime) ? active.currentTime : 0;
      const remaining = duration > 0 ? Math.max(0, duration - currentTime) : null;
      const progress = duration > 0 ? currentTime / duration : 0;
      const source = active.currentSrc || active.src || active.poster || '';
      const parsePercent = (value) => {
        if (!value || typeof value !== 'string') return null;
        const match = value.match(/([\d.]+)%/);
        if (!match) return null;
        const percent = Number.parseFloat(match[1]);
        return Number.isFinite(percent) ? Math.min(Math.max(percent / 100, 0), 1) : null;
      };

      const playedBar = document.querySelector('.ytProgressBarLineProgressBarPlayed');
      const playhead = document.querySelector('yt-progress-bar-playhead');
      const playedProgress = parsePercent(playedBar && playedBar.style ? playedBar.style.width : null);
      const playheadProgress = parsePercent(playhead && playhead.style ? playhead.style.marginLeft : null);
      const seekProgress = playedProgress !== null ? playedProgress : playheadProgress;

      return {
        key: `${source}|${Math.round(rect.top)}|${Math.round(rect.height)}|${Math.round(duration)}`,
        currentTime,
        duration,
        remaining,
        progress,
        seekProgress,
        seekBarFound: seekProgress !== null,
        ended: active.ended,
        paused: active.paused,
        hasUsableDuration: duration > 0 && Number.isFinite(duration),
      };
    });
  }

  async scrollNext(reason = 'manual skip') {
    if (!this.page || this.state === 'stopped' || this.isScrolling) return;

    try {
      this.isScrolling = true;
      await this.page.keyboard.press('ArrowDown');

      this.scrollCount++;
      this.resetVideoWatch();
      this.emitStatus();
      this.log(`Scrolled to video #${this.scrollCount} (${reason}).`);
      await this.page.waitForTimeout(900);
    } catch (err) {
      this.log(`Scroll error: ${err.message}`);
    } finally {
      this.isScrolling = false;
    }
  }

  pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.emitStatus();
      this.log('Paused.');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      this.resetVideoWatch();
      this.emitStatus();
      this.log('Resumed.');
    }
  }

  setInterval(newInterval) {
    this.interval = newInterval;
    this.resetVideoWatch();
    this.emitStatus();
    this.log(`Stuck timeout set to ${newInterval}s.`);
  }

  async stop() {
    if (this.isStopping) return;
    this.isStopping = true;
    this.state = 'stopped';
    this.stopSmartScrollLoop();
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    const browser = this.browser;
    this.browser = null;
    this.page = null;

    if (browser) {
      try {
        await Promise.race([
          browser.close(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch (e) {
        // Ignore close errors.
      }
    }
    this.log('Stopped.');
    this.emitStatus();
    this.isStopping = false;
  }
}

module.exports = { AutoScroller };

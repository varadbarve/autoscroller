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
    this.platform = platform; // 'youtube' or 'instagram'
    this.interval = interval; // fallback max wait in seconds
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
      nearEndSince: null,
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

      this.log(`Starting ${this.platform === 'youtube' ? 'YouTube Shorts' : 'Instagram Reels'} scroller using ${browserOpt.label}...`);

      const path = require('path');
      // Separate profile per platform AND browser to avoid conflicts
      this.userDataDir = path.join(__dirname, '.browser-data', `${this.platform}-${this.browserType}`);

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

      const url = this.platform === 'youtube'
        ? 'https://www.youtube.com/shorts'
        : 'https://www.instagram.com/reels/';

      this.log(`Navigating to ${url}`);
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      if (this.platform === 'instagram') {
        const loginBtn = await this.page.$('input[name="username"]');
        if (loginBtn) {
          this.state = 'login';
          this.emitStatus();
          this.log('Instagram login required. Please log in manually in the browser window.');
          this.log('The scroller will start automatically after you log in and reach the Reels page.');
          await this.waitForLogin();
        }
      }

      if (this.platform === 'youtube') {
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

  async waitForLogin() {
    const maxWait = 300000;
    const startWait = Date.now();

    while (Date.now() - startWait < maxWait) {
      try {
        const currentUrl = this.page.url();
        if (currentUrl.includes('/reels') || currentUrl.includes('/reel/')) {
          this.log('Login detected. Proceeding...');
          await this.page.waitForTimeout(3000);
          return;
        }

        const feedContent = await this.page.$('article, [role="main"] video, svg[aria-label="Reels"]');
        if (feedContent) {
          await this.page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded' });
          await this.page.waitForTimeout(3000);
          this.log('Login detected. Navigated to Reels.');
          return;
        }
      } catch (e) {
        // Page might be navigating.
      }
      await this.page.waitForTimeout(2000);
    }

    throw new Error('Login timeout. Please try again.');
  }

  async clickFirstVideo() {
    try {
      if (this.platform === 'youtube') {
        const short = await this.page.$('ytd-rich-item-renderer a#thumbnail, a.shortsLockupViewModelHostEndpoint, ytd-reel-item-renderer a, a[href*="/shorts/"]');
        if (short) {
          await short.click();
          await this.page.waitForTimeout(2000);
          this.log('Opened first Short.');
        }
      } else {
        const reel = await this.page.$('a[href*="/reel/"], div._aagu video, article video');
        if (reel) {
          await reel.click();
          await this.page.waitForTimeout(2000);
          this.log('Opened first Reel.');
        }
      }
    } catch (e) {
      this.log('First video auto-click skipped; you may already be viewing content.');
    }
  }

  startSmartScrollLoop() {
    this.stopSmartScrollLoop();
    this.resetVideoWatch();
    this.log(`Smart mode enabled. Scrolling when the active video ends; fallback max wait is ${this.interval}s.`);

    this.watchTimer = setInterval(async () => {
      if (this.state !== 'running' || this.isScrolling) return;

      try {
        const video = await this.getActiveVideoState();
        const now = Date.now();

        if (!video || !video.hasUsableDuration) {
          if (!this.videoWatch.startedAt) this.videoWatch.startedAt = now;

          if (now - this.videoWatch.startedAt >= this.interval * 1000) {
            await this.scrollNext('fallback: no readable active video');
          }
          return;
        }

        if (this.videoWatch.lastKey !== video.key) {
          this.videoWatch = {
            lastKey: video.key,
            startedAt: now,
            nearEndSince: null,
          };
          this.log(`Watching video (${Math.round(video.duration)}s) until completion...`);
        }

        if (video.paused && now - this.videoWatch.startedAt >= this.interval * 1000) {
          await this.scrollNext('fallback: video paused or blocked');
          return;
        }

        if (video.ended || video.remaining <= 0.35 || video.progress >= 0.985) {
          await this.scrollNext('video ended');
          return;
        }

        if (video.remaining <= 0.9) {
          if (!this.videoWatch.nearEndSince) this.videoWatch.nearEndSince = now;
          if (now - this.videoWatch.nearEndSince >= 700) {
            await this.scrollNext('video reached the end');
          }
          return;
        }

        this.videoWatch.nearEndSince = null;

        if (now - this.videoWatch.startedAt >= this.interval * 1000) {
          await this.scrollNext('fallback max wait reached');
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
      nearEndSince: null,
    };
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

      return {
        key: `${source}|${Math.round(rect.top)}|${Math.round(rect.height)}|${Math.round(duration)}`,
        currentTime,
        duration,
        remaining,
        progress,
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
      if (this.platform === 'youtube') {
        await this.page.keyboard.press('ArrowDown');
      } else {
        await this.page.keyboard.press('ArrowDown');
        await this.page.evaluate(() => {
          const container = document.querySelector('div._aanv')
            || document.querySelector('section main')
            || document.documentElement;
          if (container) {
            container.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
          }
        });
      }

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
    this.log(`Fallback max wait set to ${newInterval}s.`);
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

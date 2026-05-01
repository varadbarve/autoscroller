// ============================================
// AutoScroller - Dashboard Client
// ============================================

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const connectionBadge = $('#connectionBadge');
  const btnYoutube = $('#btnYoutube');
  const btnInstagram = $('#btnInstagram'); // Passive placeholder until Instagram work resumes.
  const speedSlider = $('#speedSlider');
  const speedValue = $('#speedValue');
  const btnStart = $('#btnStart');
  const btnPause = $('#btnPause');
  const btnSkip = $('#btnSkip');
  const btnStop = $('#btnStop');
  const statTime = $('#statTime');
  const statScrolls = $('#statScrolls');
  const statStatus = $('#statStatus');
  const statPlatform = $('#statPlatform');
  const logContainer = $('#logContainer');
  const btnClearLog = $('#btnClearLog');
  const particles = $('#particles');
  const browserChips = $$('.browser-chip');

  const ACTIVE_PLATFORM = 'youtube';
  const BROWSER_LABELS = {
    chromium: 'Chromium',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
  };

  let ws = null;
  let selectedPlatform = ACTIVE_PLATFORM;
  let selectedBrowser = 'chromium';
  let isPaused = false;
  let isRunning = false;

  function createParticles() {
    for (let i = 0; i < 40; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 8 + 's';
      particle.style.animationDuration = (6 + Math.random() * 6) + 's';
      particle.style.width = (2 + Math.random() * 3) + 'px';
      particle.style.height = particle.style.width;
      particle.style.opacity = (0.1 + Math.random() * 0.3).toString();
      particles.appendChild(particle);
    }
  }

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      connectionBadge.className = 'connection-badge connected';
      connectionBadge.querySelector('span:last-child').textContent = 'Connected';
      addLog('Connected to server');
    };

    ws.onclose = () => {
      connectionBadge.className = 'connection-badge disconnected';
      connectionBadge.querySelector('span:last-child').textContent = 'Disconnected';
      addLog('Disconnected from server. Reconnecting...');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      connectionBadge.className = 'connection-badge disconnected';
      connectionBadge.querySelector('span:last-child').textContent = 'Error';
    };

    ws.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(event.data));
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'status':
        updateStatus(msg.data);
        break;
      case 'log':
        addLog(msg.data.message);
        break;
      case 'error':
        addLog('Error: ' + msg.data);
        break;
    }
  }

  function updateStatus(status) {
    isRunning = ['running', 'paused', 'starting', 'login'].includes(status.state);
    isPaused = status.state === 'paused';

    animateStat(statTime, formatTime(status.sessionTime));
    animateStat(statScrolls, status.scrollCount.toString());
    statStatus.textContent = capitalizeState(status.state);
    statPlatform.textContent = status.platform ? 'YouTube' : '-';

    btnStart.disabled = isRunning;
    btnPause.disabled = !isRunning || status.state === 'starting' || status.state === 'login';
    btnSkip.disabled = !isRunning || isPaused;
    btnStop.disabled = !isRunning;

    if (isPaused) {
      btnPause.querySelector('span').textContent = 'Resume';
      btnPause.querySelector('svg').innerHTML = '<polygon points="5,3 19,12 5,21"/>';
    } else {
      btnPause.querySelector('span').textContent = 'Pause';
      btnPause.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    }

    if (status.interval && speedSlider.value != status.interval) {
      speedSlider.value = status.interval;
      speedValue.textContent = status.interval + 's';
    }
  }

  function animateStat(el, newValue) {
    if (el.textContent !== newValue) {
      el.textContent = newValue;
      el.classList.add('updated');
      setTimeout(() => el.classList.remove('updated'), 400);
    }
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function capitalizeState(state) {
    const map = {
      idle: 'Idle',
      starting: 'Starting...',
      login: 'Waiting Login',
      running: 'Running',
      paused: 'Paused',
      stopped: 'Stopped',
    };
    return map[state] || state;
  }

  function addLog(message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date().toLocaleTimeString();

    const msg = document.createElement('span');
    msg.className = 'log-msg';
    msg.textContent = message;

    entry.appendChild(time);
    entry.appendChild(msg);
    logContainer.appendChild(entry);

    while (logContainer.children.length > 100) {
      logContainer.removeChild(logContainer.firstChild);
    }

    logContainer.scrollTop = logContainer.scrollHeight;
  }

  btnYoutube.addEventListener('click', () => {
    if (isRunning) return;
    selectedPlatform = ACTIVE_PLATFORM;
    btnYoutube.classList.add('active');
    btnInstagram.classList.remove('active');
  });

  // Instagram is intentionally passive for now. Keep the button visible as a roadmap marker,
  // but do not allow the dashboard to start an Instagram session until YouTube is solid.
  btnInstagram.addEventListener('click', () => {
    selectedPlatform = ACTIVE_PLATFORM;
    btnYoutube.classList.add('active');
    btnInstagram.classList.remove('active');
    addLog('Instagram is parked for now. YouTube Shorts is the active target.');
  });

  browserChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (isRunning) return;
      selectedBrowser = chip.dataset.browser;
      browserChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  speedSlider.addEventListener('input', () => {
    speedValue.textContent = speedSlider.value + 's';
  });

  speedSlider.addEventListener('change', () => {
    if (isRunning) {
      send({ type: 'set_interval', interval: parseInt(speedSlider.value, 10) });
    }
  });

  btnStart.addEventListener('click', () => {
    selectedPlatform = ACTIVE_PLATFORM;
    send({
      type: 'start',
      platform: ACTIVE_PLATFORM,
      interval: parseInt(speedSlider.value, 10),
      browserType: selectedBrowser,
    });

    const browserLabel = BROWSER_LABELS[selectedBrowser] || selectedBrowser;
    addLog(`Starting YouTube Shorts on ${browserLabel} with ${speedSlider.value}s stuck timeout...`);
  });

  btnPause.addEventListener('click', () => {
    send({ type: isPaused ? 'resume' : 'pause' });
  });

  btnSkip.addEventListener('click', () => {
    send({ type: 'skip' });
  });

  btnStop.addEventListener('click', () => {
    send({ type: 'stop' });
    addLog('Stopping scroller...');
  });

  btnClearLog.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('Log cleared');
  });

  createParticles();
  connect();
})();

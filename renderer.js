/* ═══════════════════════════════════════════════════════════════════
   Desktop Clock — Renderer Process
   Production-grade modular clock application
   ═══════════════════════════════════════════════════════════════════ */

// ── Safe API Access ────────────────────────────────────────────────
const api = window.electronAPI || {};

// ── Utility Helpers ────────────────────────────────────────────────

/** Pad a number to at least `len` digits */
function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

/** Get current timestamp with sub-second precision */
function now() {
  return performance.now();
}

// ── Audio Engine (Web Audio API — programmatic alarm sound) ────────

const AudioEngine = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  /** Play a pleasant two-tone alarm beep pattern */
  function playBeep(duration = 200, frequency = 880, type = 'sine') {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, c.currentTime);
      gain.gain.setValueAtTime(0.35, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration / 1000);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration / 1000);
    } catch (e) {
      // Silently ignore audio errors
    }
  }

  /** Play an alarm pattern: alternating high-low beeps */
  function playAlarmPattern() {
    const notes = [880, 660, 880, 660, 880, 660];
    notes.forEach((freq, i) => {
      setTimeout(() => playBeep(180, freq, 'triangle'), i * 220);
    });
  }

  return { playBeep, playAlarmPattern };
})();

// ── Clock Engine ───────────────────────────────────────────────────

const ClockEngine = {
  _rafId: null,
  _callbacks: [],

  /** Register a callback to be invoked on every frame with the Date */
  onTick(fn) {
    this._callbacks.push(fn);
  },

  start() {
    const tick = () => {
      const d = new Date();
      for (const fn of this._callbacks) {
        fn(d);
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  },

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },
};

// ── Time Helpers ───────────────────────────────────────────────────

const TimeUtils = {
  DAYS: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],

  formatDigital(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },

  formatDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  },

  formatDateShort(date) {
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  },

  weekday(date) {
    return this.DAYS[date.getDay()];
  },

  /** Get time for a specific UTC offset */
  getOffsetTime(date, offsetHours) {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    return new Date(utc + offsetHours * 3600000);
  },

  /** Get time via IANA timezone using Intl */
  getZonedTime(date, tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
      }).formatToParts(date);

      const map = {};
      for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
      }

      return {
        hours: parseInt(map.hour, 10),
        minutes: parseInt(map.minute, 10),
        seconds: parseInt(map.second, 10),
        year: parseInt(map.year, 10),
        month: parseInt(map.month, 10),
        day: parseInt(map.day, 10),
        weekday: map.weekday,
      };
    } catch {
      // Fallback: use UTC offset
      const offset = parseInt(tz, 10) || 0;
      return null;
    }
  },

  /** Compare two times (HH:MM) ignoring seconds */
  timesMatch(a, b) {
    return a.hours === b.hours && a.minutes === b.minutes;
  },

  /** Parse HH:MM string */
  parseTime(str) {
    const [h, m] = str.split(':').map(Number);
    return { hours: h, minutes: m };
  },
};

// ═══════════════════════════════════════════════════════════════════
// Module Manager — Tab Switching
// ═══════════════════════════════════════════════════════════════════

const ModuleManager = {
  _current: 'clock',

  init() {
    document.querySelectorAll('.nav-btn[data-module]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const module = btn.dataset.module;
        this.switchTo(module);
      });
    });
  },

  switchTo(name) {
    if (this._current === name) return;

    // Update nav buttons
    document.querySelectorAll('.nav-btn[data-module]').forEach((b) => {
      b.classList.toggle('active', b.dataset.module === name);
    });

    // Update modules
    document.querySelectorAll('.module').forEach((m) => m.classList.remove('active'));
    const target = document.getElementById(`module-${name}`);
    if (target) target.classList.add('active');

    this._current = name;
  },

  get current() {
    return this._current;
  },
};

// ═══════════════════════════════════════════════════════════════════
// Clock Type Manager — Digital / Analog / Flip
// ═══════════════════════════════════════════════════════════════════

const ClockTypeManager = {
  _current: 'digital',

  init() {
    document.querySelectorAll('.clock-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.switchTo(type);
      });
    });
  },

  switchTo(type) {
    this._current = type;

    document.querySelectorAll('.clock-type-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === type);
    });

    document.querySelectorAll('#module-clock .clock-panel').forEach((p) => p.classList.remove('active'));

    const panel = document.getElementById(`clock-${type}`);
    if (panel) panel.classList.add('active');
  },

  get current() {
    return this._current;
  },
};

// ═══════════════════════════════════════════════════════════════════
// Digital Clock
// ═══════════════════════════════════════════════════════════════════

const DigitalClock = {
  _elTime: null,
  _elDate: null,
  _elWeekday: null,

  init() {
    this._elTime = document.getElementById('digital-time');
    this._elDate = document.getElementById('digital-date');
    this._elWeekday = document.getElementById('digital-weekday');
  },

  update(date) {
    if (!this._elTime) return;
    this._elTime.textContent = TimeUtils.formatDigital(date);
    this._elDate.textContent = TimeUtils.formatDate(date);
    this._elWeekday.textContent = TimeUtils.weekday(date);
  },
};

// ═══════════════════════════════════════════════════════════════════
// Analog Clock
// ═══════════════════════════════════════════════════════════════════

const AnalogClock = {
  _elHour: null,
  _elMinute: null,
  _elSecond: null,
  _initialized: false,

  init() {
    this._elHour = document.getElementById('hand-hour');
    this._elMinute = document.getElementById('hand-minute');
    this._elSecond = document.getElementById('hand-second');
    this._drawMarkers();
    this._initialized = true;
  },

  _drawMarkers() {
    const hourGroup = document.getElementById('hour-markers');
    const minuteGroup = document.getElementById('minute-markers');
    if (!hourGroup || !minuteGroup) return;

    const cx = 150, cy = 150;

    // Hour markers (12 ticks)
    for (let i = 0; i < 12; i++) {
      const angle = (i * 30 - 90) * (Math.PI / 180);
      const x1 = cx + 120 * Math.cos(angle);
      const y1 = cy + 120 * Math.sin(angle);
      const x2 = cx + 135 * Math.cos(angle);
      const y2 = cy + 135 * Math.sin(angle);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'var(--clock-hour)');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      hourGroup.appendChild(line);
    }

    // Minute markers (60 ticks)
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue; // skip hour positions
      const angle = (i * 6 - 90) * (Math.PI / 180);
      const x1 = cx + 128 * Math.cos(angle);
      const y1 = cy + 128 * Math.sin(angle);
      const x2 = cx + 135 * Math.cos(angle);
      const y2 = cy + 135 * Math.sin(angle);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'var(--clock-ring)');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-linecap', 'round');
      minuteGroup.appendChild(line);
    }
  },

  update(date) {
    if (!this._initialized) return;

    const ms = date.getMilliseconds();
    const seconds = date.getSeconds() + ms / 1000;
    const minutes = date.getMinutes() + seconds / 60;
    const hours = (date.getHours() % 12) + minutes / 60;

    const secDeg = seconds * 6;
    const minDeg = minutes * 6;
    const hourDeg = hours * 30;

    this._elSecond.setAttribute('transform', `rotate(${secDeg}, 150, 150)`);
    this._elMinute.setAttribute('transform', `rotate(${minDeg}, 150, 150)`);
    this._elHour.setAttribute('transform', `rotate(${hourDeg}, 150, 150)`);
  },
};

// ═══════════════════════════════════════════════════════════════════
// Flip Clock
// ═══════════════════════════════════════════════════════════════════

const FlipClock = {
  _prev: { hh: '', mm: '', ss: '' },
  _elDate: null,

  init() {
    this._elDate = document.getElementById('flip-date');
  },

  update(date) {
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());

    // Only animate changed digits
    this._setDigit('hours-tens', hh[0], this._prev.hh[0]);
    this._setDigit('hours-ones', hh[1], this._prev.hh[1]);
    this._setDigit('mins-tens', mm[0], this._prev.mm[0]);
    this._setDigit('mins-ones', mm[1], this._prev.mm[1]);
    this._setDigit('secs-tens', ss[0], this._prev.ss[0]);
    this._setDigit('secs-ones', ss[1], this._prev.ss[1]);

    this._prev = { hh, mm, ss };

    if (this._elDate) {
      this._elDate.textContent = `${TimeUtils.formatDate(date)} ${TimeUtils.weekday(date)}`;
    }
  },

  _setDigit(which, newVal, oldVal) {
    const digit = document.querySelector(`.flip-digit[data-digit="${which}"]`);
    if (!digit) return;

    const top = digit.querySelector('.flip-top span');
    const bottom = digit.querySelector('.flip-bottom span');

    if (oldVal !== undefined && oldVal !== '' && newVal !== oldVal) {
      // Start flip animation with old value on top, new on bottom
      top.textContent = oldVal;
      bottom.textContent = newVal;
      digit.classList.remove('flipping');
      void digit.offsetWidth; // force reflow
      digit.classList.add('flipping');

      // After half the animation, swap the top value
      setTimeout(() => {
        top.textContent = newVal;
      }, 250);

      // Clean up animation class
      setTimeout(() => {
        digit.classList.remove('flipping');
      }, 500);
    } else if (oldVal === undefined || oldVal === '') {
      top.textContent = newVal;
      bottom.textContent = newVal;
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
// World Clock
// ═══════════════════════════════════════════════════════════════════

const WorldClock = {
  _cards: [],

  init() {
    this._cards = Array.from(document.querySelectorAll('.world-card'));
    this._cards.forEach((card) => {
      card.addEventListener('click', () => this._onCardClick(card));
    });
  },

  update(date) {
    this._cards.forEach((card) => {
      const tz = card.dataset.tz;
      const offsetStr = card.dataset.utc; // e.g. "+8", "-5"

      let displayTime, displayDate;
      const zoned = TimeUtils.getZonedTime(date, tz);

      if (zoned) {
        displayTime = `${pad(zoned.hours)}:${pad(zoned.minutes)}:${pad(zoned.seconds)}`;
        displayDate = `${zoned.year}/${pad(zoned.month)}/${pad(zoned.day)}`;
      } else {
        // Fallback: compute from UTC offset
        const offset = parseInt(offsetStr, 10) || 0;
        const localDate = new Date(date.getTime() + (offset - (-date.getTimezoneOffset() / 60)) * 3600000);
        displayTime = TimeUtils.formatDigital(localDate);
        displayDate = TimeUtils.formatDateShort(localDate);
      }

      card.querySelector('.world-time').textContent = displayTime;
      card.querySelector('.world-date').textContent = displayDate;

      // Compute diff from local
      const offsetNum = parseInt(offsetStr, 10) || 0;
      const localOffset = -date.getTimezoneOffset() / 60;
      const diff = offsetNum - localOffset;
      const diffEl = card.querySelector('.world-diff');
      if (diff === 0) {
        diffEl.textContent = '本地时间';
      } else if (diff > 0) {
        diffEl.textContent = `快 ${diff} 小时`;
      } else {
        diffEl.textContent = `慢 ${Math.abs(diff)} 小时`;
      }
    });
  },

  _onCardClick(card) {
    // Animate
    card.classList.remove('switching');
    void card.offsetWidth;
    card.classList.add('switching');

    // Switch to clock module and set the city's time as the main clock
    // We store the selected city offset so the main clock can show it
    const tz = card.dataset.tz;
    const cityName = card.dataset.city;
    const offsetStr = card.dataset.utc;

    // For simplicity, we apply an offset overlay to the main clock
    // Store in session
    window.__clockOverlay = { tz, city: cityName, offset: offsetStr };

    ModuleManager.switchTo('clock');

    // Brief toast-like feedback
    this._showToast(`已切换至 ${cityName} 时间`);
  },

  _showToast(msg) {
    // Remove existing toast
    const old = document.querySelector('.world-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.className = 'world-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 2000);
  },
};

// ═══════════════════════════════════════════════════════════════════
// Alarms
// ═══════════════════════════════════════════════════════════════════

const AlarmManager = {
  _alarms: [], // { id, time: "HH:MM", label, enabled, ringing }
  _elList: null,
  _elTimeInput: null,
  _elLabelInput: null,
  _elAddBtn: null,
  _lastCheck: '',

  init() {
    this._elList = document.getElementById('alarm-list');
    this._elTimeInput = document.getElementById('alarm-time-input');
    this._elLabelInput = document.getElementById('alarm-label-input');
    this._elAddBtn = document.getElementById('alarm-add-btn');

    this._elAddBtn.addEventListener('click', () => this._add());
    this._elLabelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._add();
    });
    this._elTimeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._add();
    });

    // Load saved alarms
    this._load();
  },

  _add() {
    const timeVal = this._elTimeInput.value;
    if (!timeVal) return;

    const label = this._elLabelInput.value.trim() || '闹钟';
    const alarm = {
      id: Date.now(),
      time: timeVal, // "HH:MM"
      label,
      enabled: true,
      ringing: false,
    };

    this._alarms.push(alarm);
    this._render();
    this._save();

    this._elTimeInput.value = '';
    this._elLabelInput.value = '';
  },

  _remove(id) {
    this._alarms = this._alarms.filter((a) => a.id !== id);
    this._render();
    this._save();
  },

  _toggle(id) {
    const alarm = this._alarms.find((a) => a.id === id);
    if (alarm) {
      alarm.enabled = !alarm.enabled;
      alarm.ringing = false;
      this._render();
      this._save();
    }
  },

  _dismissRinging(id) {
    const alarm = this._alarms.find((a) => a.id === id);
    if (alarm) {
      alarm.ringing = false;
      this._render();
    }
  },

  check(date) {
    const now = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    // Only check once per minute
    if (now === this._lastCheck) return;
    this._lastCheck = now;

    let anyTriggered = false;
    this._alarms.forEach((alarm) => {
      if (alarm.enabled && alarm.time === now && !alarm.ringing) {
        alarm.ringing = true;
        anyTriggered = true;
      }
    });

    if (anyTriggered) {
      this._render();
      // Play alarm sound
      AudioEngine.playAlarmPattern();
      // Send native notification
      const ringing = this._alarms.filter((a) => a.ringing);
      const labels = ringing.map((a) => a.label).join(', ');
      if (api.showNotification) {
        api.showNotification('⏰ 闹钟响了', `${labels} — ${now}`);
      }
    }
  },

  _render() {
    if (!this._elList) return;

    if (this._alarms.length === 0) {
      this._elList.innerHTML = '<li class="alarm-empty">暂无闹钟，点击 + 添加</li>';
      return;
    }

    this._elList.innerHTML = this._alarms
      .map(
        (a) => `
        <li class="alarm-item${a.ringing ? ' ringing' : ''}" data-id="${a.id}">
          <button class="alarm-toggle${a.enabled ? ' active' : ''}" data-action="toggle" data-id="${a.id}"></button>
          <div class="alarm-info">
            <span class="alarm-info-time">${a.time}</span>
            <span class="alarm-info-label">${a.label}</span>
          </div>
          <button class="alarm-delete-btn" data-action="delete" data-id="${a.id}" title="删除">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </li>
      `
      )
      .join('');

    // Bind events via event delegation
    this._elList.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggle(Number(btn.dataset.id));
      });
    });

    this._elList.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._remove(Number(btn.dataset.id));
      });
    });

    // Click on ringing alarm to dismiss
    this._elList.querySelectorAll('.alarm-item.ringing').forEach((item) => {
      item.addEventListener('click', () => {
        this._dismissRinging(Number(item.dataset.id));
      });
    });
  },

  _save() {
    const data = this._alarms.map(({ id, time, label, enabled }) => ({ id, time, label, enabled }));
    try {
      localStorage.setItem('clock-alarms', JSON.stringify(data));
    } catch (e) {
      // Storage full or unavailable
    }
    // Also persist via main process
    if (api.setSetting) {
      api.setSetting('alarms', data);
    }
  },

  _load() {
    // Try main process first
    if (api.getSettings) {
      api.getSettings().then((settings) => {
        if (settings && settings.alarms) {
          this._alarms = settings.alarms.map((a) => ({ ...a, ringing: false }));
          this._render();
        }
      });
    }
    // Fallback to localStorage
    try {
      const raw = localStorage.getItem('clock-alarms');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.length > 0 && this._alarms.length === 0) {
          this._alarms = data.map((a) => ({ ...a, ringing: false }));
          this._render();
        }
      }
    } catch (e) {
      // ignore
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
// Timer
// ═══════════════════════════════════════════════════════════════════

const TimerModule = {
  _totalMs: 0,
  _remainingMs: 0,
  _intervalId: null,
  _running: false,
  _paused: false,

  _elDisplay: null,
  _elProgress: null,
  _elInputs: null,
  _elHours: null,
  _elMinutes: null,
  _elSeconds: null,
  _elStartBtn: null,
  _elPauseBtn: null,
  _elResetBtn: null,

  init() {
    this._elDisplay = document.getElementById('timer-display');
    this._elProgress = document.getElementById('timer-ring-progress');
    this._elInputs = document.getElementById('timer-inputs');
    this._elHours = document.getElementById('timer-hours');
    this._elMinutes = document.getElementById('timer-minutes');
    this._elSeconds = document.getElementById('timer-seconds');
    this._elStartBtn = document.getElementById('timer-start-btn');
    this._elPauseBtn = document.getElementById('timer-pause-btn');
    this._elResetBtn = document.getElementById('timer-reset-btn');

    this._elStartBtn.addEventListener('click', () => this._start());
    this._elPauseBtn.addEventListener('click', () => this._pause());
    this._elResetBtn.addEventListener('click', () => this._reset());

    // Set initial ring circumference
    const circumference = 2 * Math.PI * 90; // r=90
    this._elProgress.style.strokeDasharray = circumference;
    this._elProgress.style.strokeDashoffset = '0';

    this._updateDisplay(0);
  },

  _start() {
    if (this._running && this._paused) {
      // Resume
      this._paused = false;
      this._running = true;
      this._startCountdown();
      this._showRunning();
      return;
    }

    // Fresh start
    const h = parseInt(this._elHours.value, 10) || 0;
    const m = parseInt(this._elMinutes.value, 10) || 0;
    const s = parseInt(this._elSeconds.value, 10) || 0;
    this._totalMs = (h * 3600 + m * 60 + s) * 1000;

    if (this._totalMs <= 0) return;

    this._remainingMs = this._totalMs;
    this._running = true;
    this._paused = false;
    this._elInputs.style.display = 'none';
    this._startCountdown();
    this._showRunning();
  },

  _pause() {
    if (!this._running) return;
    this._paused = true;
    this._running = false;
    clearInterval(this._intervalId);
    this._elStartBtn.style.display = '';
    this._elStartBtn.textContent = '继续';
    this._elPauseBtn.style.display = 'none';
  },

  _reset() {
    this._running = false;
    this._paused = false;
    clearInterval(this._intervalId);
    this._remainingMs = 0;
    this._totalMs = 0;
    this._updateDisplay(0);
    this._updateRing(0);
    this._elStartBtn.textContent = '开始';
    this._elStartBtn.style.display = '';
    this._elPauseBtn.style.display = 'none';
    this._elInputs.style.display = '';
    this._elHours.value = '0';
    this._elMinutes.value = '5';
    this._elSeconds.value = '0';
  },

  _startCountdown() {
    clearInterval(this._intervalId);
    const startTime = now();
    const startRemaining = this._remainingMs;

    this._intervalId = setInterval(() => {
      const elapsed = now() - startTime;
      this._remainingMs = Math.max(0, startRemaining - elapsed);

      this._updateDisplay(this._remainingMs);
      this._updateRing(this._remainingMs / this._totalMs);

      if (this._remainingMs <= 0) {
        this._finish();
      }
    }, 40); // ~25fps for smooth ring animation
  },

  _finish() {
    clearInterval(this._intervalId);
    this._running = false;
    this._paused = false;
    this._updateDisplay(0);
    this._updateRing(0);

    // Play alarm
    AudioEngine.playAlarmPattern();

    // Notification
    if (api.showNotification) {
      api.showNotification('⏰ 计时结束', '倒计时已结束！');
    }

    // Reset UI
    setTimeout(() => this._reset(), 1500);
  },

  _updateDisplay(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    this._elDisplay.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  },

  _updateRing(ratio) {
    const circumference = 2 * Math.PI * 90;
    this._elProgress.style.strokeDashoffset = circumference * (1 - ratio);
  },

  _showRunning() {
    this._elStartBtn.style.display = 'none';
    this._elPauseBtn.style.display = '';
  },
};

// ═══════════════════════════════════════════════════════════════════
// Stopwatch
// ═══════════════════════════════════════════════════════════════════

const StopwatchModule = {
  _running: false,
  _startTime: 0,
  _accumulated: 0,
  _intervalId: null,
  _laps: [],

  _elDisplay: null,
  _elStartBtn: null,
  _elPauseBtn: null,
  _elLapBtn: null,
  _elResetBtn: null,
  _elLapList: null,

  init() {
    this._elDisplay = document.getElementById('stopwatch-display');
    this._elStartBtn = document.getElementById('sw-start-btn');
    this._elPauseBtn = document.getElementById('sw-pause-btn');
    this._elLapBtn = document.getElementById('sw-lap-btn');
    this._elResetBtn = document.getElementById('sw-reset-btn');
    this._elLapList = document.getElementById('lap-list');

    this._elStartBtn.addEventListener('click', () => this._start());
    this._elPauseBtn.addEventListener('click', () => this._pause());
    this._elLapBtn.addEventListener('click', () => this._lap());
    this._elResetBtn.addEventListener('click', () => this._reset());
  },

  _start() {
    if (!this._running) {
      this._running = true;
      this._startTime = now();

      this._intervalId = setInterval(() => {
        const elapsed = this._accumulated + (now() - this._startTime);
        this._updateDisplay(elapsed);
      }, 30);
    }

    this._elStartBtn.style.display = 'none';
    this._elPauseBtn.style.display = '';
    this._elLapBtn.style.display = '';
  },

  _pause() {
    if (this._running) {
      this._accumulated += now() - this._startTime;
      this._running = false;
      clearInterval(this._intervalId);
    }

    this._elStartBtn.style.display = '';
    this._elStartBtn.textContent = '继续';
    this._elPauseBtn.style.display = 'none';
    this._elLapBtn.style.display = 'none';
  },

  _lap() {
    if (!this._running) return;
    const elapsed = this._accumulated + (now() - this._startTime);
    this._laps.unshift({ lap: this._laps.length + 1, time: elapsed, total: elapsed });
    this._renderLaps();
  },

  _reset() {
    this._running = false;
    clearInterval(this._intervalId);
    this._accumulated = 0;
    this._startTime = 0;
    this._laps = [];
    this._updateDisplay(0);
    this._renderLaps();

    this._elStartBtn.style.display = '';
    this._elStartBtn.textContent = '开始';
    this._elPauseBtn.style.display = 'none';
    this._elLapBtn.style.display = 'none';
  },

  _updateDisplay(ms) {
    const totalMs = Math.floor(ms);
    const cs = Math.floor((totalMs % 1000) / 10);
    const totalSec = Math.floor(totalMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    this._elDisplay.textContent = `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
  },

  _formatLap(ms) {
    const totalMs = Math.floor(ms);
    const cs = Math.floor((totalMs % 1000) / 10);
    const totalSec = Math.floor(totalMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
    }
    return `${pad(m)}:${pad(s)}.${pad(cs)}`;
  },

  _renderLaps() {
    if (this._laps.length === 0) {
      this._elLapList.innerHTML = '';
      return;
    }
    this._elLapList.innerHTML = this._laps
      .map(
        (l) => `
        <li class="lap-item">
          <span class="lap-index">计次 #${l.lap}</span>
          <span class="lap-time">${this._formatLap(l.time)}</span>
        </li>
      `
      )
      .join('');
  },
};

// ═══════════════════════════════════════════════════════════════════
// Timer Type Switcher
// ═══════════════════════════════════════════════════════════════════

const TimerTypeManager = {
  init() {
    document.querySelectorAll('.timer-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.timer;
        document.querySelectorAll('.timer-type-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.timer === type);
        });
        document.getElementById('timer-panel').classList.toggle('active', type === 'timer');
        document.getElementById('stopwatch-panel').classList.toggle('active', type === 'stopwatch');
      });
    });
  },
};

// ═══════════════════════════════════════════════════════════════════
// Theme Manager
// ═══════════════════════════════════════════════════════════════════

const ThemeManager = {
  _current: 'dark',

  init() {
    // Load saved theme
    if (api.getSettings) {
      api.getSettings().then((settings) => {
        if (settings && settings.theme) {
          this.set(settings.theme);
        } else {
          this.set('dark');
        }
      });
    } else {
      this.set('dark');
    }

    // Bind theme button
    document.getElementById('btn-theme').addEventListener('click', () => this.toggle());

    // Listen for theme toggle from tray
    if (api.onThemeToggle) {
      api.onThemeToggle(() => this.toggle());
    }
  },

  toggle() {
    const next = this._current === 'dark' ? 'light' : 'dark';
    this.set(next);
  },

  set(theme) {
    this._current = theme;
    document.body.className = `theme-${theme}`;

    // Update icon visibility
    const lightIcon = document.getElementById('theme-icon-light');
    const darkIcon = document.getElementById('theme-icon-dark');
    if (lightIcon) lightIcon.style.display = theme === 'light' ? 'none' : '';
    if (darkIcon) darkIcon.style.display = theme === 'dark' ? 'none' : '';

    // Persist
    if (api.setSetting) {
      api.setSetting('theme', theme);
    }
    try {
      localStorage.setItem('clock-theme', theme);
    } catch (e) {
      // ignore
    }
  },

  get current() {
    return this._current;
  },
};

// ═══════════════════════════════════════════════════════════════════
// Window Controls
// ═══════════════════════════════════════════════════════════════════

const WindowControls = {
  _isFullscreen: false,
  _isMaximized: false,

  init() {
    document.getElementById('btn-minimize').addEventListener('click', () => {
      if (api.minimize) api.minimize();
    });

    document.getElementById('btn-close').addEventListener('click', () => {
      if (api.close) api.close();
    });

    // Maximize (窗口化全屏) — fills screen, keeps titlebar + nav
    document.getElementById('btn-maximize').addEventListener('click', () => {
      this.toggleMaximize();
    });

    document.getElementById('btn-alwaysontop').addEventListener('click', () => {
      if (api.toggleAlwaysOnTop) api.toggleAlwaysOnTop();
      this._updateAlwaysOnTopBtn();
    });

    // Double-click on titlebar → immersive fullscreen
    document.querySelector('.titlebar-drag').addEventListener('dblclick', () => {
      this.toggleImmersiveFullscreen();
    });

    // Double-click on clock area → immersive fullscreen
    document.getElementById('module-clock').addEventListener('dblclick', (e) => {
      // Don't trigger on interactive elements
      if (e.target.closest('button') || e.target.closest('input')) return;
      this.toggleImmersiveFullscreen();
    });

    // F11 → immersive fullscreen
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        this.toggleImmersiveFullscreen();
      }
      if (e.key === 'Escape' && this._isFullscreen) {
        this.toggleImmersiveFullscreen();
      }
    });

    // Init always-on-top button state
    this._updateAlwaysOnTopBtn();
  },

  toggleMaximize() {
    if (api.maximize) {
      api.maximize();
    }
    this._isMaximized = !this._isMaximized;
    this._updateMaxBtnIcon();
  },

  toggleImmersiveFullscreen() {
    if (api.toggleFullscreen) {
      api.toggleFullscreen();
    }
    this._isFullscreen = !this._isFullscreen;
    document.body.classList.toggle('fullscreen-mode', this._isFullscreen);
  },

  _updateMaxBtnIcon() {
    const btn = document.getElementById('btn-maximize');
    if (!btn) return;
    if (this._isMaximized) {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="7" y="7" width="10" height="10" rx="1"></rect>
        <rect x="4" y="4" width="12" height="12" rx="2"></rect>
      </svg>`;
      btn.title = '还原';
    } else {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="4" y="4" width="16" height="16" rx="2"></rect>
      </svg>`;
      btn.title = '窗口化全屏';
    }
  },

  _updateAlwaysOnTopBtn() {
    if (api.isAlwaysOnTop) {
      api.isAlwaysOnTop().then((state) => {
        const btn = document.getElementById('btn-alwaysontop');
        if (btn) {
          btn.style.color = state ? 'var(--accent)' : '';
        }
      });
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
// Main Clock Tick Handler (with overlay support for world clock)
// ═══════════════════════════════════════════════════════════════════

const MainClockHandler = {
  update(date) {
    // Check for world-clock time overlay
    let displayDate = date;
    if (window.__clockOverlay) {
      const overlay = window.__clockOverlay;
      const zoned = TimeUtils.getZonedTime(date, overlay.tz);
      if (zoned) {
        displayDate = new Date(
          zoned.year,
          zoned.month - 1,
          zoned.day,
          zoned.hours,
          zoned.minutes,
          zoned.seconds,
          date.getMilliseconds()
        );
      } else {
        const offset = parseInt(overlay.offset, 10) || 0;
        const utc = date.getTime() + date.getTimezoneOffset() * 60000;
        displayDate = new Date(utc + offset * 3600000);
      }
    }

    // Update the active clock type
    const type = ClockTypeManager.current;
    if (type === 'digital') DigitalClock.update(displayDate);
    else if (type === 'analog') AnalogClock.update(displayDate);
    else if (type === 'flip') FlipClock.update(displayDate);

    // Always update world clock
    WorldClock.update(date);

    // Always check alarms
    AlarmManager.check(date);
  },
};

// ═══════════════════════════════════════════════════════════════════
// App Initialization
// ═══════════════════════════════════════════════════════════════════

function initApp() {
  // Initialize all modules
  ModuleManager.init();
  ClockTypeManager.init();
  DigitalClock.init();
  AnalogClock.init();
  FlipClock.init();
  WorldClock.init();
  AlarmManager.init();
  TimerModule.init();
  StopwatchModule.init();
  TimerTypeManager.init();
  ThemeManager.init();
  WindowControls.init();

  // Register clock tick
  ClockEngine.onTick((date) => MainClockHandler.update(date));

  // Start the clock engine
  ClockEngine.start();
}

// ── Boot ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);

/* ═══════════════════════════════════════════════════════════════════
   Desktop Clock — Renderer Process v2
   ═══════════════════════════════════════════════════════════════════ */

const api = window.electronAPI || {};

// ── Utilities ──────────────────────────────────────────────────────
function pad(n, len = 2) { return String(n).padStart(len, '0'); }
function now() { return performance.now(); }

// ── Audio Engine ───────────────────────────────────────────────────
const AudioEngine = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function playBeep(duration = 200, frequency = 880, type = 'sine') {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, c.currentTime);
      gain.gain.setValueAtTime(0.35, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration / 1000);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(c.currentTime); osc.stop(c.currentTime + duration / 1000);
    } catch (e) { /* ignore */ }
  }
  function playAlarmPattern() {
    [880, 660, 880, 660, 880, 660].forEach((freq, i) => {
      setTimeout(() => playBeep(180, freq, 'triangle'), i * 220);
    });
  }
  return { playBeep, playAlarmPattern };
})();

// ── Clock Engine ───────────────────────────────────────────────────
const ClockEngine = {
  _rafId: null, _callbacks: [],
  onTick(fn) { this._callbacks.push(fn); },
  start() {
    const tick = () => { const d = new Date(); for (const fn of this._callbacks) fn(d); this._rafId = requestAnimationFrame(tick); };
    this._rafId = requestAnimationFrame(tick);
  },
  stop() { if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; } },
};

// ── Time Helpers ───────────────────────────────────────────────────
const TimeUtils = {
  DAYS: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
  formatDigital(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; },
  formatDate(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`; },
  formatDateShort(date) { return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`; },
  weekday(date) { return this.DAYS[date.getDay()]; },
  getZonedTime(date, tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
      }).formatToParts(date);
      const map = {}; for (const p of parts) { if (p.type !== 'literal') map[p.type] = p.value; }
      return { hours: parseInt(map.hour, 10), minutes: parseInt(map.minute, 10), seconds: parseInt(map.second, 10), year: parseInt(map.year, 10), month: parseInt(map.month, 10), day: parseInt(map.day, 10), weekday: map.weekday };
    } catch { return null; }
  },
};

// ═══════════════════════════════════════════════════════════════════
// Module Manager
// ═══════════════════════════════════════════════════════════════════
const ModuleManager = {
  _current: 'clock',
  init() {
    document.querySelectorAll('.nav-btn[data-module]').forEach((btn) => {
      btn.addEventListener('click', () => this.switchTo(btn.dataset.module));
    });
  },
  switchTo(name) {
    if (this._current === name) return;
    document.querySelectorAll('.nav-btn[data-module]').forEach((b) => b.classList.toggle('active', b.dataset.module === name));
    document.querySelectorAll('.module').forEach((m) => m.classList.remove('active'));
    const target = document.getElementById(`module-${name}`);
    if (target) target.classList.add('active');
    this._current = name;
  },
  get current() { return this._current; },
};

// ═══════════════════════════════════════════════════════════════════
// Settings Manager
// ═══════════════════════════════════════════════════════════════════
const SettingsManager = {
  _clockType: 'digital',
  _theme: 'dark',
  _alwaysOnTop: false,

  init() {
    // Load saved
    if (api.getSettings) {
      api.getSettings().then((s) => {
        if (s) {
          if (s.theme) this._theme = s.theme;
          if (s.clockType) this._clockType = s.clockType;
          if (s.alwaysOnTop !== undefined) this._alwaysOnTop = s.alwaysOnTop;
        }
        this._applyAll();
      });
    } else {
      this._applyAll();
    }

    // Settings button
    document.getElementById('btn-settings').addEventListener('click', () => this._open());
    document.getElementById('settings-close').addEventListener('click', () => this._close());
    document.getElementById('settings-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this._close();
    });

    // Clock type options
    document.querySelectorAll('#setting-clock-type .settings-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#setting-clock-type .settings-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._clockType = btn.dataset.type;
        this._applyClockType();
        if (api.setSetting) api.setSetting('clockType', this._clockType);
      });
    });

    // Theme options
    document.querySelectorAll('#setting-theme .settings-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._theme = btn.dataset.theme;
        this._applyTheme();
        if (api.setSetting) api.setSetting('theme', this._theme);
      });
    });

    // Always on top toggle
    document.getElementById('ontop-toggle').addEventListener('click', () => {
      if (api.toggleAlwaysOnTop) api.toggleAlwaysOnTop();
    });

    // Esc to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('settings-overlay').classList.contains('open')) {
        this._close();
      }
    });
  },

  _open() {
    document.getElementById('settings-overlay').classList.add('open');
    this._syncUI();
  },
  _close() {
    document.getElementById('settings-overlay').classList.remove('open');
  },

  _syncUI() {
    // Clock type
    document.querySelectorAll('#setting-clock-type .settings-option').forEach(b => {
      b.classList.toggle('active', b.dataset.type === this._clockType);
    });
    // Theme
    document.querySelectorAll('#setting-theme .settings-option').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === this._theme);
    });
  },

  _applyAll() {
    this._applyTheme();
    this._applyClockType();
  },

  _applyTheme() {
    document.body.className = `theme-${this._theme}`;
    document.querySelectorAll('#setting-theme .settings-option').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === this._theme);
    });
  },

  _applyClockType() {
    document.querySelectorAll('#module-clock .clock-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`clock-${this._clockType}`);
    if (panel) panel.classList.add('active');
    document.querySelectorAll('#setting-clock-type .settings-option').forEach(b => {
      b.classList.toggle('active', b.dataset.type === this._clockType);
    });
  },

  get clockType() { return this._clockType; },
  get theme() { return this._theme; },
};

// ═══════════════════════════════════════════════════════════════════
// Digital Clock
// ═══════════════════════════════════════════════════════════════════
const DigitalClock = {
  _elTime: null, _elDate: null, _elWeekday: null,
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
  _elHour: null, _elMinute: null, _elSecond: null, _initialized: false,

  init() {
    this._elHour = document.getElementById('hand-hour');
    this._elMinute = document.getElementById('hand-minute');
    this._elSecond = document.getElementById('hand-second');
    this._drawMarkers();
    this._drawNumerals();
    this._initialized = true;
  },

  _drawMarkers() {
    const hourGroup = document.getElementById('hour-markers');
    const minuteGroup = document.getElementById('minute-markers');
    if (!hourGroup || !minuteGroup) return;
    const cx = 150, cy = 150;

    // Hour markers (12 large ticks at outer edge)
    for (let i = 0; i < 12; i++) {
      const angle = (i * 30 - 90) * (Math.PI / 180);
      const x1 = cx + 120 * Math.cos(angle);
      const y1 = cy + 120 * Math.sin(angle);
      const x2 = cx + 135 * Math.cos(angle);
      const y2 = cy + 135 * Math.sin(angle);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'var(--clock-hour)');
      line.setAttribute('stroke-width', '3'); line.setAttribute('stroke-linecap', 'round');
      hourGroup.appendChild(line);
    }

    // Minute markers (60 small ticks)
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const angle = (i * 6 - 90) * (Math.PI / 180);
      const x1 = cx + 128 * Math.cos(angle);
      const y1 = cy + 128 * Math.sin(angle);
      const x2 = cx + 135 * Math.cos(angle);
      const y2 = cy + 135 * Math.sin(angle);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'var(--clock-ring)');
      line.setAttribute('stroke-width', '1'); line.setAttribute('stroke-linecap', 'round');
      minuteGroup.appendChild(line);
    }
  },

  _drawNumerals() {
    const numeralsGroup = document.getElementById('clock-numerals');
    if (!numeralsGroup) return;
    const cx = 150, cy = 150;
    for (let i = 1; i <= 12; i++) {
      const angle = (i * 30 - 90) * (Math.PI / 180);
      const x = cx + 105 * Math.cos(angle);
      const y = cy + 105 * Math.sin(angle);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x); text.setAttribute('y', y);
      text.setAttribute('class', 'clock-numeral');
      text.textContent = i;
      numeralsGroup.appendChild(text);
    }
  },

  update(date) {
    if (!this._initialized) return;
    const ms = date.getMilliseconds();
    const seconds = date.getSeconds() + ms / 1000;
    const minutes = date.getMinutes() + seconds / 60;
    const hours = (date.getHours() % 12) + minutes / 60;
    this._elSecond.setAttribute('transform', `rotate(${seconds * 6}, 150, 150)`);
    this._elMinute.setAttribute('transform', `rotate(${minutes * 6}, 150, 150)`);
    this._elHour.setAttribute('transform', `rotate(${hours * 30}, 150, 150)`);
  },
};

// ═══════════════════════════════════════════════════════════════════
// Flip Clock — smooth two-phase animation
// ═══════════════════════════════════════════════════════════════════
const FlipClock = {
  _prev: { hh: '', mm: '', ss: '' },
  _elDate: null,
  _flipTimer: {},

  init() {
    this._elDate = document.getElementById('flip-date');
  },

  update(date) {
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());

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

    const topVal = digit.querySelector('.flip-top-val');
    const bottomVal = digit.querySelector('.flip-bottom-val');

    // Initial render — just set values without animation
    if (oldVal === undefined || oldVal === '') {
      topVal.textContent = newVal;
      bottomVal.textContent = newVal;
      return;
    }

    // No change — skip
    if (newVal === oldVal) return;

    // Cancel any in-progress flip on this digit
    if (this._flipTimer[which]) {
      clearTimeout(this._flipTimer[which].mid);
      clearTimeout(this._flipTimer[which].end);
      digit.classList.remove('flipping');
    }

    // Start flip: top shows old value, bottom pre-loads new value
    topVal.textContent = oldVal;
    bottomVal.textContent = newVal;

    // Trigger CSS animation
    digit.classList.remove('flipping');
    void digit.offsetWidth; // force reflow
    digit.classList.add('flipping');

    // Mid-point (300ms): swap top to new value while card is edge-on
    const midTimer = setTimeout(() => {
      topVal.textContent = newVal;
      // Update bottom val again to ensure consistency
      bottomVal.textContent = newVal;
    }, 300);

    // End (600ms): clean up
    const endTimer = setTimeout(() => {
      digit.classList.remove('flipping');
      delete this._flipTimer[which];
    }, 600);

    this._flipTimer[which] = { mid: midTimer, end: endTimer };
  },
};

// ═══════════════════════════════════════════════════════════════════
// World Clock
// ═══════════════════════════════════════════════════════════════════
const WorldClock = {
  _cards: [],
  init() {
    this._cards = Array.from(document.querySelectorAll('.world-card'));
    this._cards.forEach((card) => card.addEventListener('click', () => this._onCardClick(card)));
  },
  update(date) {
    this._cards.forEach((card) => {
      const tz = card.dataset.tz;
      const offsetStr = card.dataset.utc;
      let displayTime, displayDate;
      const zoned = TimeUtils.getZonedTime(date, tz);
      if (zoned) {
        displayTime = `${pad(zoned.hours)}:${pad(zoned.minutes)}:${pad(zoned.seconds)}`;
        displayDate = `${zoned.year}/${pad(zoned.month)}/${pad(zoned.day)}`;
      } else {
        const offset = parseInt(offsetStr, 10) || 0;
        const localDate = new Date(date.getTime() + (offset - (-date.getTimezoneOffset() / 60)) * 3600000);
        displayTime = TimeUtils.formatDigital(localDate);
        displayDate = TimeUtils.formatDateShort(localDate);
      }
      card.querySelector('.world-time').textContent = displayTime;
      card.querySelector('.world-date').textContent = displayDate;
      const offsetNum = parseInt(offsetStr, 10) || 0;
      const localOffset = -date.getTimezoneOffset() / 60;
      const diff = offsetNum - localOffset;
      const diffEl = card.querySelector('.world-diff');
      if (diff === 0) diffEl.textContent = '本地时间';
      else if (diff > 0) diffEl.textContent = `快 ${diff} 小时`;
      else diffEl.textContent = `慢 ${Math.abs(diff)} 小时`;
    });
  },
  _onCardClick(card) {
    card.classList.remove('switching'); void card.offsetWidth; card.classList.add('switching');
    window.__clockOverlay = { tz: card.dataset.tz, city: card.dataset.city, offset: card.dataset.utc };
    ModuleManager.switchTo('clock');
    this._showToast(`已切换至 ${card.dataset.city} 时间`);
  },
  _showToast(msg) {
    const old = document.querySelector('.world-toast'); if (old) old.remove();
    const toast = document.createElement('div'); toast.className = 'world-toast'; toast.textContent = msg;
    document.body.appendChild(toast); setTimeout(() => toast.remove(), 2000);
  },
};

// ═══════════════════════════════════════════════════════════════════
// Alarms — with scroll wheel picker
// ═══════════════════════════════════════════════════════════════════
const AlarmManager = {
  _alarms: [],
  _hours: 0, _minutes: 0,
  _elList: null, _elLabelInput: null, _elAddBtn: null,
  _elHoursDisp: null, _elMinutesDisp: null,
  _lastCheck: '',

  init() {
    this._elList = document.getElementById('alarm-list');
    this._elLabelInput = document.getElementById('alarm-label-input');
    this._elAddBtn = document.getElementById('alarm-add-btn');
    this._elHoursDisp = document.getElementById('alarm-hours-display');
    this._elMinutesDisp = document.getElementById('alarm-minutes-display');

    this._elAddBtn.addEventListener('click', () => this._add());
    this._elLabelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._add(); });

    // Scroll wheel buttons
    document.querySelectorAll('.alarm-wheel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const delta = btn.classList.contains('alarm-wheel-up') ? 1 : -1;
        if (target === 'hours') {
          this._hours = (this._hours + delta + 24) % 24;
        } else {
          this._minutes = (this._minutes + delta + 60) % 60;
        }
        this._updateDisplay();
      });
    });

    // Mouse wheel support on displays
    [this._elHoursDisp, this._elMinutesDisp].forEach((el) => {
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const target = el === this._elHoursDisp ? 'hours' : 'minutes';
        const delta = e.deltaY < 0 ? 1 : -1;
        if (target === 'hours') {
          this._hours = (this._hours + delta + 24) % 24;
        } else {
          this._minutes = (this._minutes + delta + 60) % 60;
        }
        this._updateDisplay();
      });
    });

    this._updateDisplay();
    this._load();
  },

  _updateDisplay() {
    this._elHoursDisp.textContent = pad(this._hours);
    this._elMinutesDisp.textContent = pad(this._minutes);
  },

  _add() {
    const timeVal = `${pad(this._hours)}:${pad(this._minutes)}`;
    const label = this._elLabelInput.value.trim() || '闹钟';
    const alarm = { id: Date.now(), time: timeVal, label, enabled: true, ringing: false };
    this._alarms.push(alarm);
    this._render(); this._save();
    this._elLabelInput.value = '';
    // Reset to current time
    const now = new Date();
    this._hours = now.getHours();
    this._minutes = now.getMinutes();
    this._updateDisplay();
  },

  _remove(id) { this._alarms = this._alarms.filter((a) => a.id !== id); this._render(); this._save(); },
  _toggle(id) {
    const alarm = this._alarms.find((a) => a.id === id);
    if (alarm) { alarm.enabled = !alarm.enabled; alarm.ringing = false; this._render(); this._save(); }
  },
  _dismissRinging(id) {
    const alarm = this._alarms.find((a) => a.id === id);
    if (alarm) { alarm.ringing = false; this._render(); }
  },

  check(date) {
    const nowStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (nowStr === this._lastCheck) return;
    this._lastCheck = nowStr;
    let anyTriggered = false;
    this._alarms.forEach((alarm) => {
      if (alarm.enabled && alarm.time === nowStr && !alarm.ringing) { alarm.ringing = true; anyTriggered = true; }
    });
    if (anyTriggered) {
      this._render();
      AudioEngine.playAlarmPattern();
      const ringing = this._alarms.filter((a) => a.ringing);
      const labels = ringing.map((a) => a.label).join(', ');
      if (api.showNotification) api.showNotification('⏰ 闹钟响了', `${labels} — ${nowStr}`);
    }
  },

  _render() {
    if (!this._elList) return;
    if (this._alarms.length === 0) { this._elList.innerHTML = '<li class="alarm-empty">暂无闹钟，点击 + 添加</li>'; return; }
    this._elList.innerHTML = this._alarms.map((a) => `
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
    `).join('');
    this._elList.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggle(Number(btn.dataset.id)); });
    });
    this._elList.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._remove(Number(btn.dataset.id)); });
    });
    this._elList.querySelectorAll('.alarm-item.ringing').forEach((item) => {
      item.addEventListener('click', () => { this._dismissRinging(Number(item.dataset.id)); });
    });
  },

  _save() {
    const data = this._alarms.map(({ id, time, label, enabled }) => ({ id, time, label, enabled }));
    try { localStorage.setItem('clock-alarms', JSON.stringify(data)); } catch (e) {}
    if (api.setSetting) api.setSetting('alarms', data);
  },

  _load() {
    if (api.getSettings) {
      api.getSettings().then((settings) => {
        if (settings && settings.alarms) { this._alarms = settings.alarms.map((a) => ({ ...a, ringing: false })); this._render(); }
      });
    }
    try {
      const raw = localStorage.getItem('clock-alarms');
      if (raw) { const data = JSON.parse(raw); if (data.length > 0 && this._alarms.length === 0) { this._alarms = data.map((a) => ({ ...a, ringing: false })); this._render(); } }
    } catch (e) {}
  },
};

// ═══════════════════════════════════════════════════════════════════
// Timer
// ═══════════════════════════════════════════════════════════════════
const TimerModule = {
  _totalMs: 0, _remainingMs: 0, _intervalId: null, _running: false, _paused: false,
  _elDisplay: null, _elProgress: null, _elInputs: null, _elHours: null, _elMinutes: null, _elSeconds: null,
  _elStartBtn: null, _elPauseBtn: null, _elResetBtn: null,

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
    const circumference = 2 * Math.PI * 90;
    this._elProgress.style.strokeDasharray = circumference;
    this._elProgress.style.strokeDashoffset = '0';
    this._updateDisplay(0);
  },

  _start() {
    if (this._running && this._paused) { this._paused = false; this._running = true; this._startCountdown(); this._showRunning(); return; }
    const h = parseInt(this._elHours.value, 10) || 0;
    const m = parseInt(this._elMinutes.value, 10) || 0;
    const s = parseInt(this._elSeconds.value, 10) || 0;
    this._totalMs = (h * 3600 + m * 60 + s) * 1000;
    if (this._totalMs <= 0) return;
    this._remainingMs = this._totalMs; this._running = true; this._paused = false;
    this._elInputs.style.display = 'none'; this._startCountdown(); this._showRunning();
  },
  _pause() { if (!this._running) return; this._paused = true; this._running = false; clearInterval(this._intervalId); this._elStartBtn.style.display = ''; this._elStartBtn.textContent = '继续'; this._elPauseBtn.style.display = 'none'; },
  _reset() { this._running = false; this._paused = false; clearInterval(this._intervalId); this._remainingMs = 0; this._totalMs = 0; this._updateDisplay(0); this._updateRing(0); this._elStartBtn.textContent = '开始'; this._elStartBtn.style.display = ''; this._elPauseBtn.style.display = 'none'; this._elInputs.style.display = ''; this._elHours.value = '0'; this._elMinutes.value = '5'; this._elSeconds.value = '0'; },

  _startCountdown() {
    clearInterval(this._intervalId);
    const startTime = now(); const startRemaining = this._remainingMs;
    this._intervalId = setInterval(() => {
      const elapsed = now() - startTime;
      this._remainingMs = Math.max(0, startRemaining - elapsed);
      this._updateDisplay(this._remainingMs);
      this._updateRing(this._remainingMs / this._totalMs);
      if (this._remainingMs <= 0) this._finish();
    }, 40);
  },
  _finish() { clearInterval(this._intervalId); this._running = false; this._paused = false; this._updateDisplay(0); this._updateRing(0); AudioEngine.playAlarmPattern(); if (api.showNotification) api.showNotification('⏰ 计时结束', '倒计时已结束！'); setTimeout(() => this._reset(), 1500); },
  _updateDisplay(ms) { const totalSec = Math.ceil(ms / 1000); const h = Math.floor(totalSec / 3600); const m = Math.floor((totalSec % 3600) / 60); const s = totalSec % 60; this._elDisplay.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`; },
  _updateRing(ratio) { const circumference = 2 * Math.PI * 90; this._elProgress.style.strokeDashoffset = circumference * (1 - ratio); },
  _showRunning() { this._elStartBtn.style.display = 'none'; this._elPauseBtn.style.display = ''; },
};

// ═══════════════════════════════════════════════════════════════════
// Stopwatch
// ═══════════════════════════════════════════════════════════════════
const StopwatchModule = {
  _running: false, _startTime: 0, _accumulated: 0, _intervalId: null, _laps: [],
  _elDisplay: null, _elStartBtn: null, _elPauseBtn: null, _elLapBtn: null, _elResetBtn: null, _elLapList: null,

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
    if (!this._running) { this._running = true; this._startTime = now(); this._intervalId = setInterval(() => { const elapsed = this._accumulated + (now() - this._startTime); this._updateDisplay(elapsed); }, 30); }
    this._elStartBtn.style.display = 'none'; this._elPauseBtn.style.display = ''; this._elLapBtn.style.display = '';
  },
  _pause() { if (this._running) { this._accumulated += now() - this._startTime; this._running = false; clearInterval(this._intervalId); } this._elStartBtn.style.display = ''; this._elStartBtn.textContent = '继续'; this._elPauseBtn.style.display = 'none'; this._elLapBtn.style.display = 'none'; },
  _lap() { if (!this._running) return; const elapsed = this._accumulated + (now() - this._startTime); this._laps.unshift({ lap: this._laps.length + 1, time: elapsed, total: elapsed }); this._renderLaps(); },
  _reset() { this._running = false; clearInterval(this._intervalId); this._accumulated = 0; this._startTime = 0; this._laps = []; this._updateDisplay(0); this._renderLaps(); this._elStartBtn.style.display = ''; this._elStartBtn.textContent = '开始'; this._elPauseBtn.style.display = 'none'; this._elLapBtn.style.display = 'none'; },
  _updateDisplay(ms) { const totalMs = Math.floor(ms); const cs = Math.floor((totalMs % 1000) / 10); const totalSec = Math.floor(totalMs / 1000); const h = Math.floor(totalSec / 3600); const m = Math.floor((totalSec % 3600) / 60); const s = totalSec % 60; this._elDisplay.textContent = `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`; },
  _formatLap(ms) { const totalMs = Math.floor(ms); const cs = Math.floor((totalMs % 1000) / 10); const totalSec = Math.floor(totalMs / 1000); const h = Math.floor(totalSec / 3600); const m = Math.floor((totalSec % 3600) / 60); const s = totalSec % 60; if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`; return `${pad(m)}:${pad(s)}.${pad(cs)}`; },
  _renderLaps() { if (this._laps.length === 0) { this._elLapList.innerHTML = ''; return; } this._elLapList.innerHTML = this._laps.map((l) => `<li class="lap-item"><span class="lap-index">计次 #${l.lap}</span><span class="lap-time">${this._formatLap(l.time)}</span></li>`).join(''); },
};

// ═══════════════════════════════════════════════════════════════════
// Timer Type Switcher
// ═══════════════════════════════════════════════════════════════════
const TimerTypeManager = {
  init() {
    document.querySelectorAll('.timer-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.timer;
        document.querySelectorAll('.timer-type-btn').forEach((b) => b.classList.toggle('active', b.dataset.timer === type));
        document.getElementById('timer-panel').classList.toggle('active', type === 'timer');
        document.getElementById('stopwatch-panel').classList.toggle('active', type === 'stopwatch');
      });
    });
  },
};

// ═══════════════════════════════════════════════════════════════════
// Window Controls — fixed maximize sync
// ═══════════════════════════════════════════════════════════════════
const WindowControls = {
  _isFullscreen: false,
  _isMaximized: false,

  init() {
    document.getElementById('btn-minimize').addEventListener('click', () => { if (api.minimize) api.minimize(); });
    document.getElementById('btn-close').addEventListener('click', () => { if (api.close) api.close(); });

    // Maximize (窗口化全屏)
    document.getElementById('btn-maximize').addEventListener('click', () => {
      if (api.maximize) api.maximize();
    });

    // Always on top
    document.getElementById('btn-alwaysontop').addEventListener('click', () => {
      if (api.toggleAlwaysOnTop) api.toggleAlwaysOnTop();
      this._updateAlwaysOnTopBtn();
    });

    // Listen for maximize state changes from main process
    if (api.onMaximizeChange) {
      api.onMaximizeChange((isMaximized) => {
        this._isMaximized = isMaximized;
        this._updateMaxBtnIcon();
      });
    }

    // Double-click titlebar → immersive fullscreen
    document.querySelector('.titlebar-drag').addEventListener('dblclick', () => this.toggleImmersiveFullscreen());

    // Double-click clock area → immersive fullscreen
    document.getElementById('module-clock').addEventListener('dblclick', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      this.toggleImmersiveFullscreen();
    });

    // F11 → immersive fullscreen, Esc → exit
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F11') { e.preventDefault(); this.toggleImmersiveFullscreen(); }
      if (e.key === 'Escape' && this._isFullscreen) { this.toggleImmersiveFullscreen(); }
    });

    this._updateMaxBtnIcon();
    this._updateAlwaysOnTopBtn();
  },

  toggleImmersiveFullscreen() {
    if (api.toggleFullscreen) api.toggleFullscreen();
    this._isFullscreen = !this._isFullscreen;
    document.body.classList.toggle('fullscreen-mode', this._isFullscreen);
  },

  _updateMaxBtnIcon() {
    const btn = document.getElementById('btn-maximize');
    if (!btn) return;
    if (this._isMaximized) {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="7" y="7" width="10" height="10" rx="1"></rect><rect x="4" y="4" width="12" height="12" rx="2"></rect></svg>`;
      btn.title = '还原';
    } else {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>`;
      btn.title = '窗口化全屏';
    }
  },

  _updateAlwaysOnTopBtn() {
    if (api.isAlwaysOnTop) {
      api.isAlwaysOnTop().then((state) => {
        const btn = document.getElementById('btn-alwaysontop');
        if (btn) btn.style.color = state ? 'var(--accent)' : '';
      });
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
// Main Clock Tick Handler
// ═══════════════════════════════════════════════════════════════════
const MainClockHandler = {
  update(date) {
    let displayDate = date;
    if (window.__clockOverlay) {
      const overlay = window.__clockOverlay;
      const zoned = TimeUtils.getZonedTime(date, overlay.tz);
      if (zoned) {
        displayDate = new Date(zoned.year, zoned.month - 1, zoned.day, zoned.hours, zoned.minutes, zoned.seconds, date.getMilliseconds());
      } else {
        const offset = parseInt(overlay.offset, 10) || 0;
        const utc = date.getTime() + date.getTimezoneOffset() * 60000;
        displayDate = new Date(utc + offset * 3600000);
      }
    }

    const type = SettingsManager.clockType;
    if (type === 'digital') DigitalClock.update(displayDate);
    else if (type === 'analog') AnalogClock.update(displayDate);
    else if (type === 'flip') FlipClock.update(displayDate);

    WorldClock.update(date);
    AlarmManager.check(date);
  },
};

// ═══════════════════════════════════════════════════════════════════
// App Initialization
// ═══════════════════════════════════════════════════════════════════
function initApp() {
  SettingsManager.init();
  ModuleManager.init();
  DigitalClock.init();
  AnalogClock.init();
  FlipClock.init();
  WorldClock.init();
  AlarmManager.init();
  TimerModule.init();
  StopwatchModule.init();
  TimerTypeManager.init();
  WindowControls.init();

  ClockEngine.onTick((date) => MainClockHandler.update(date));
  ClockEngine.start();

  // Tray theme toggle
  if (api.onThemeToggle) {
    api.onThemeToggle(() => {
      SettingsManager._theme = SettingsManager._theme === 'dark' ? 'light' : 'dark';
      SettingsManager._applyTheme();
      if (api.setSetting) api.setSetting('theme', SettingsManager._theme);
    });
  }
}

document.addEventListener('DOMContentLoaded', initApp);

/**
 * Wind Plus — Home Assistant Lovelace.
 * Compass rose, speed / direction, 12/24h stats, and daily history.
 */
(function () {
  const LitElement = Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
  const { html, css } = LitElement.prototype;

  const DEFAULTS = Object.freeze({
    name: "Wind",
    look: "rose",
    size: "100",
    max_speed: 40,
    show_history: true,
    history_days: 14,
    show_gust: true,
  });

  const LOOKS = Object.freeze({
    rose: { label: "Compass rose" },
    modern: { label: "Modern dial" },
  });

  const CARDINALS = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];

  const CARDINAL_DEG = Object.freeze({
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  });

  const BEAUFORT = [
    { max: 1, label: "Calm" },
    { max: 4, label: "Light air" },
    { max: 8, label: "Light breeze" },
    { max: 13, label: "Gentle breeze" },
    { max: 19, label: "Moderate breeze" },
    { max: 25, label: "Fresh breeze" },
    { max: 32, label: "Strong breeze" },
    { max: 39, label: "Near gale" },
    { max: 47, label: "Gale" },
    { max: 55, label: "Strong gale" },
    { max: 64, label: "Storm" },
    { max: 73, label: "Violent storm" },
    { max: Infinity, label: "Hurricane" },
  ];

  function lookIdOf(config) {
    const id = config?.look;
    return LOOKS[id] ? id : "rose";
  }

  function sizeOf(config) {
    const id = String(config?.size ?? "100");
    return id === "50" || id === "75" || id === "100" ? id : "100";
  }

  function mergeConfig(config) {
    const merged = { ...DEFAULTS, ...(config || {}) };
    merged.size = sizeOf(merged);
    merged.look = lookIdOf(merged);
    return merged;
  }

  function num(config, key, fallback) {
    const v = config[key];
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function entityState(hass, entityId) {
    if (!entityId || !hass?.states?.[entityId]) return null;
    return hass.states[entityId];
  }

  function parseNumber(v) {
    if (v == null || v === "" || v === "unknown" || v === "unavailable") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function unitOf(st) {
    return String(st?.attributes?.unit_of_measurement || "").toLowerCase();
  }

  function toMph(value, unit) {
    if (value == null) return null;
    const u = String(unit || "").toLowerCase();
    if (u === "km/h" || u === "kph" || u === "kmh") return value / 1.609344;
    if (u === "m/s" || u === "mps") return value * 2.236936;
    if (u === "kt" || u === "kts" || u === "kn") return value * 1.150779;
    return value;
  }

  function fromMph(mph, unit) {
    if (mph == null) return null;
    if (unit === "km/h") return mph * 1.609344;
    if (unit === "m/s") return mph / 2.236936;
    if (unit === "kt") return mph / 1.150779;
    return mph;
  }

  function displayUnit(cfg, st) {
    const sys = cfg.unit_system;
    if (sys === "metric") return "km/h";
    if (sys === "ms") return "m/s";
    if (sys === "knots") return "kt";
    if (sys === "imperial") return "mph";
    const u = unitOf(st);
    if (u === "km/h" || u === "kph" || u === "kmh") return "km/h";
    if (u === "m/s" || u === "mps") return "m/s";
    if (u === "kt" || u === "kts" || u === "kn") return "kt";
    return "mph";
  }

  function roundSpeed(n) {
    if (n == null || !Number.isFinite(n)) return 0;
    const abs = Math.abs(n);
    if (abs >= 10) return Math.round(n);
    return Math.round(n * 10) / 10;
  }

  function formatSpeed(mph, unit) {
    if (mph == null) return "—";
    return String(roundSpeed(fromMph(mph, unit)));
  }

  function beaufortOf(mph) {
    const v = mph == null ? 0 : mph;
    return BEAUFORT.find((b) => v < b.max) || BEAUFORT[BEAUFORT.length - 1];
  }

  function parseHeading(st) {
    if (!st) return null;
    const n = parseNumber(st.state);
    if (n != null) return ((n % 360) + 360) % 360;
    const raw = String(st.state || "").trim().toUpperCase().replace(/\s+/g, "");
    if (CARDINAL_DEG[raw] != null) return CARDINAL_DEG[raw];
    return null;
  }

  function toCardinal(deg) {
    if (deg == null || !Number.isFinite(deg)) return "—";
    const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
    return CARDINALS[i];
  }

  function stamp(v) {
    if (v == null) return NaN;
    if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function hourStats(rows, sinceMs, untilMs, liveMph, srcUnit) {
    let sum = 0;
    let n = 0;
    let peak = 0;
    for (const row of rows || []) {
      const end = stamp(row.end);
      const start = stamp(row.start);
      if (!Number.isFinite(end)) continue;
      if (untilMs != null && start >= untilMs) continue;
      if (end <= sinceMs) continue;
      const mean = toMph(parseNumber(row.mean), srcUnit);
      const max = toMph(parseNumber(row.max), srcUnit);
      if (mean != null) {
        sum += mean;
        n += 1;
      }
      if (max != null) peak = Math.max(peak, max);
      else if (mean != null) peak = Math.max(peak, mean);
    }
    if (liveMph != null) peak = Math.max(peak, liveMph);
    return {
      avg: n ? roundSpeed(sum / n) : liveMph != null ? roundSpeed(liveMph) : null,
      peak: n || liveMph != null ? roundSpeed(peak) : null,
    };
  }

  function dayKey(ms, hass) {
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(ms));
    } catch {
      const d = new Date(ms);
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }
  }

  function weekdayLetter(ms, hass) {
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        weekday: "narrow",
      }).format(new Date(ms));
    } catch {
      return ["S", "M", "T", "W", "T", "F", "S"][new Date(ms).getDay()];
    }
  }

  function dayNum(ms) {
    return String(new Date(ms).getDate());
  }

  function monthDay(ms, hass) {
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        month: "short",
        day: "numeric",
      }).format(new Date(ms));
    } catch {
      const d = new Date(ms);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
  }

  function stClass(hass, id) {
    return hass?.states?.[id]?.attributes?.device_class || "";
  }

  function needleColor(mph) {
    const b = beaufortOf(mph).label;
    if (b === "Calm" || b === "Light air") return "#7ecfff";
    if (b.includes("breeze") && !b.startsWith("Strong")) return "#3db8ff";
    if (b === "Strong breeze" || b === "Near gale") return "#f8c15c";
    return "#f87171";
  }

  class WindPlusCard extends LitElement {
    static get properties() {
      return {
        hass: {},
        config: {},
        _historyDays: { state: true },
        _hours: { state: true },
        _days: { state: true },
        _selectedDay: { state: true },
        _histError: { state: true },
      };
    }

    static getConfigElement() {
      return document.createElement("wind-plus-card-editor");
    }

    static getStubConfig(hass) {
      const ids = Object.keys(hass?.states || {});
      const entity =
        ids.find((id) => stClass(hass, id) === "wind_speed" && /wind_speed/i.test(id)) ||
        ids.find((id) => stClass(hass, id) === "wind_speed") ||
        ids.find((id) => /wind_speed/i.test(id)) ||
        "";
      const direction =
        ids.find((id) => stClass(hass, id) === "wind_direction") ||
        ids.find((id) => /wind_heading|wind_bearing|wind_dir/i.test(id)) ||
        "";
      const gust =
        ids.find((id) => /gust/i.test(id) && stClass(hass, id) === "wind_speed") ||
        "";
      return {
        type: "custom:wind-plus-card",
        entity,
        direction_entity: direction,
        gust_entity: gust,
        look: "rose",
        size: "100",
        name: "Wind",
      };
    }

    constructor() {
      super();
      this._hours = [];
      this._days = [];
      this._historyDays = 14;
      this._selectedDay = null;
      this._histError = "";
      this._histKey = "";
    }

    getCardSize() {
      const size = Number(sizeOf(this.config));
      const base = this.config?.show_history === false ? 4 : 6;
      return Math.max(2, Math.round((base * size) / 100));
    }

    setConfig(config) {
      if (!config) throw new Error("Invalid configuration");
      this.config = mergeConfig(config);
      this._historyDays = num(this.config, "history_days", 14);
      this.dataset.size = sizeOf(this.config);
    }

    updated(changed) {
      this.dataset.size = sizeOf(this.config);
      if (changed.has("hass") || changed.has("config")) {
        this._loadHistory();
      }
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._histKey = "";
    }

    _moreInfo(entityId) {
      if (!entityId) return;
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          bubbles: true,
          composed: true,
          detail: { entityId },
        })
      );
    }

    async _loadHistory() {
      const entity = this.config?.entity;
      const hass = this.hass;
      if (!entity || !hass?.callWS) return;
      const days = Math.max(7, Number(this._historyDays) || 14);
      const key = `${entity}|${days}|${Math.floor(Date.now() / 120000)}`;
      if (key === this._histKey) return;
      this._histKey = key;
      const end = new Date();
      const startDaily = new Date(end.getTime() - (days + 1) * 86400000);
      const startHourly = new Date(end.getTime() - 36 * 3600000);
      try {
        const [daily, hourly] = await Promise.all([
          hass.callWS({
            type: "recorder/statistics_during_period",
            start_time: startDaily.toISOString(),
            end_time: end.toISOString(),
            statistic_ids: [entity],
            period: "day",
            types: ["mean", "max"],
          }),
          hass.callWS({
            type: "recorder/statistics_during_period",
            start_time: startHourly.toISOString(),
            end_time: end.toISOString(),
            statistic_ids: [entity],
            period: "hour",
            types: ["mean", "max"],
          }),
        ]);
        this._days = daily?.[entity] || [];
        this._hours = hourly?.[entity] || [];
        this._histError = "";
      } catch (err) {
        this._histError = err?.message || "history unavailable";
        this._days = [];
        this._hours = [];
      }
    }

    _model() {
      const cfg = mergeConfig(this.config || {});
      const st = entityState(this.hass, cfg.entity);
      const dirSt = entityState(this.hass, cfg.direction_entity);
      const gustSt = entityState(this.hass, cfg.gust_entity);
      const unit = displayUnit(cfg, st);
      const live = st ? toMph(parseNumber(st.state), unitOf(st)) : null;
      const heading = parseHeading(dirSt);
      const gust = gustSt ? toMph(parseNumber(gustSt.state), unitOf(gustSt)) : null;
      const now = Date.now();
      const last12 = live != null ? hourStats(this._hours, now - 12 * 3600000, now, live, unitOf(st)) : { avg: null, peak: null };
      const last24 = live != null ? hourStats(this._hours, now - 24 * 3600000, now, live, unitOf(st)) : { avg: null, peak: null };
      const unavailable = !st || ["unavailable", "unknown"].includes(String(st.state));
      const calm = live == null || live < 0.5;
      return {
        cfg,
        st,
        dirSt,
        gustSt,
        unit,
        live: live != null ? roundSpeed(live) : null,
        heading,
        cardinal: toCardinal(heading),
        gust: gust != null ? roundSpeed(gust) : null,
        last12,
        last24,
        lookId: lookIdOf(cfg),
        size: sizeOf(cfg),
        unavailable,
        calm,
        beaufort: beaufortOf(live),
        title: cfg.name || st?.attributes?.friendly_name || "Wind",
        maxSpeed: Math.max(10, num(cfg, "max_speed", 40)),
      };
    }

    _historyBars(unit) {
      const want = Number(this._historyDays) || 14;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const byStart = new Map();
      for (const row of this._days || []) {
        const mph = toMph(parseNumber(row.max) ?? parseNumber(row.mean), unitOf(entityState(this.hass, this.config?.entity)));
        byStart.set(stamp(row.start), roundSpeed(mph || 0));
      }
      const bars = [];
      const live = this._model().live;
      for (let i = want - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const startMs = d.getTime();
        let amount = 0;
        let matched = false;
        for (const [ms, val] of byStart) {
          if (Math.abs(ms - startMs) < 3 * 3600000) {
            amount = val;
            matched = true;
            break;
          }
        }
        if (!matched) {
          const key = dayKey(startMs, this.hass);
          for (const [ms, val] of byStart) {
            if (dayKey(ms, this.hass) === key) {
              amount = val;
              break;
            }
          }
        }
        if (i === 0 && live != null && live > amount) amount = live;
        bars.push({
          start: startMs,
          amount,
          label:
            want <= 7
              ? weekdayLetter(startMs, this.hass)
              : want <= 14 || i === 0 || (want - 1 - i) % 5 === 0
                ? dayNum(startMs)
                : "",
          title: `${monthDay(startMs, this.hass)} · peak ${formatSpeed(amount, unit)} ${unit}`,
        });
      }
      return bars;
    }

    render() {
      if (!this.hass || !this.config) return html``;
      const m = this._model();
      if (!m.cfg.entity) {
        return html`
          <ha-card>
            <div class="wrap setup">
              <p>Pick a wind speed sensor in the card editor.</p>
            </div>
          </ha-card>
        `;
      }
      const bars = m.cfg.show_history !== false ? this._historyBars(m.unit) : [];
      const maxBar = Math.max(0.01, ...bars.map((b) => b.amount));
      const selected =
        this._selectedDay != null
          ? bars.find((b) => b.start === this._selectedDay) || null
          : bars[bars.length - 1] || null;
      const periodPeak = roundSpeed(Math.max(0, ...bars.map((b) => b.amount)));

      return html`
        <ha-card>
          <div class="wrap">
            <div class="header">
              <button class="title" @click=${() => this._moreInfo(m.cfg.entity)}>
                ${m.title}
              </button>
              ${m.unavailable
                ? html`<span class="badge warn">Unavailable</span>`
                : html`<span class="badge ${m.calm ? "calm" : "wind"}">${m.beaufort.label}</span>`}
            </div>

            <div class="body">
              <div class="gauge-col" aria-hidden="true">
                <div class="compass look-${m.lookId}">
                  <div
                    class="compass-svg"
                    .innerHTML=${this._compassSvg(m)}
                  ></div>
                </div>
              </div>

              <div class="info-col">
                <div class="tiles">
                  <button class="tile" @click=${() => this._moreInfo(m.cfg.entity)}>
                    <span class="tile-k">Now</span>
                    <span class="tile-v">${formatSpeed(m.live, m.unit)} <small>${m.unit}</small></span>
                  </button>
                  <button class="tile" @click=${() => this._moreInfo(m.cfg.direction_entity)}>
                    <span class="tile-k">From</span>
                    <span class="tile-v"
                      >${m.cardinal}${m.heading != null
                        ? html`<small>${Math.round(m.heading)}°</small>`
                        : ""}</span
                    >
                  </button>
                </div>

                <div class="stats">
                  <div class="stat">
                    <span class="stat-k">12h avg</span>
                    <span class="stat-v">${formatSpeed(m.last12.avg, m.unit)} ${m.unit}</span>
                  </div>
                  <div class="stat">
                    <span class="stat-k">24h peak</span>
                    <span class="stat-v">${formatSpeed(m.last24.peak, m.unit)} ${m.unit}</span>
                  </div>
                  ${m.cfg.show_gust !== false && m.cfg.gust_entity
                    ? html`
                        <div class="stat">
                          <span class="stat-k">Gust</span>
                          <span class="stat-v">${formatSpeed(m.gust, m.unit)} ${m.unit}</span>
                        </div>
                      `
                    : html`
                        <div class="stat">
                          <span class="stat-k">24h avg</span>
                          <span class="stat-v">${formatSpeed(m.last24.avg, m.unit)} ${m.unit}</span>
                        </div>
                      `}
                </div>

                ${m.cfg.show_history !== false
                  ? html`
                      <div class="hist">
                        <div class="hist-head">
                          <span class="hist-title">Daily peak</span>
                          <div class="pills">
                            ${[7, 14, 30].map(
                              (d) => html`
                                <button
                                  class="pill ${this._historyDays === d ? "on" : ""}"
                                  @click=${() => {
                                    this._historyDays = d;
                                    this._histKey = "";
                                    this._loadHistory();
                                  }}
                                >
                                  ${d}d
                                </button>
                              `
                            )}
                          </div>
                        </div>
                        <div class="chart ${bars.length > 16 ? "dense" : ""}" role="img" aria-label="Daily peak wind">
                          ${bars.map(
                            (b) => html`
                              <button
                                class="bar-col ${selected?.start === b.start ? "sel" : ""} ${b.amount > 0.5 ? "wet" : ""}"
                                title=${b.title}
                                @click=${() => {
                                  this._selectedDay = b.start;
                                }}
                              >
                                <span
                                  class="bar"
                                  style="height:${Math.max(b.amount > 0.5 ? 6 : 2, (b.amount / maxBar) * 100)}%"
                                ></span>
                                <span class="bar-l">${b.label}</span>
                              </button>
                            `
                          )}
                        </div>
                        <div class="hist-foot">
                          <span
                            >${selected
                              ? `${monthDay(selected.start, this.hass)} · peak ${formatSpeed(selected.amount, m.unit)} ${m.unit}`
                              : ""}</span
                          >
                          <span>${this._historyDays}d peak ${formatSpeed(periodPeak, m.unit)} ${m.unit}</span>
                        </div>
                        ${this._histError
                          ? html`<div class="hist-err">${this._histError}</div>`
                          : ""}
                      </div>
                    `
                  : ""}
              </div>
            </div>
          </div>
        </ha-card>
      `;
    }

    _compassSvg(m) {
      return m.lookId === "modern" ? this._svgModern(m) : this._svgRose(m);
    }

    _svgRose(m) {
      const deg = m.heading == null ? 0 : m.heading;
      const color = needleColor(m.live);
      const uid = `w${Math.abs(this.config?.entity?.length || 1)}`;
      let ticks = "";
      for (let a = 0; a < 360; a += 5) {
        const rad = ((a - 90) * Math.PI) / 180;
        const major = a % 90 === 0;
        const mid = a % 45 === 0;
        const outer = 92;
        const inner = major ? 74 : mid ? 80 : 86;
        const x1 = (100 + Math.cos(rad) * outer).toFixed(2);
        const y1 = (100 + Math.sin(rad) * outer).toFixed(2);
        const x2 = (100 + Math.cos(rad) * inner).toFixed(2);
        const y2 = (100 + Math.sin(rad) * inner).toFixed(2);
        ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${major ? "#e8eef4" : mid ? "#9aa7b4" : "#5c6770"}" stroke-width="${major ? 2.4 : mid ? 1.6 : 1}" stroke-linecap="round"/>`;
      }
      const labels = [
        [0, "N", "#ff6b6b", 15],
        [90, "E", "#d9e2ea", 13],
        [180, "S", "#d9e2ea", 13],
        [270, "W", "#d9e2ea", 13],
        [45, "NE", "#8b98a5", 9],
        [135, "SE", "#8b98a5", 9],
        [225, "SW", "#8b98a5", 9],
        [315, "NW", "#8b98a5", 9],
      ]
        .map(([a, t, fill, size]) => {
          const rad = ((a - 90) * Math.PI) / 180;
          const r = a % 90 === 0 ? 50 : 55;
          const x = (100 + Math.cos(rad) * r).toFixed(2);
          const y = (100 + Math.sin(rad) * r + size * 0.35).toFixed(2);
          return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="${fill}">${t}</text>`;
        })
        .join("");
      const needleOp = m.calm ? 0.28 : 1;
      const speed = formatSpeed(m.live, m.unit);
      return `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="${uid}-face" cx="50%" cy="38%" r="70%">
              <stop offset="0%" stop-color="#3a4550"/>
              <stop offset="100%" stop-color="#1b2228"/>
            </radialGradient>
            <linearGradient id="${uid}-ring" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#d7dee6"/>
              <stop offset="100%" stop-color="#8b97a3"/>
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="96" fill="url(#${uid}-ring)"/>
          <circle cx="100" cy="100" r="90" fill="url(#${uid}-face)" stroke="#0e1418" stroke-width="1.5"/>
          ${ticks}
          ${labels}
          <g transform="rotate(${deg} 100 100)" opacity="${needleOp}">
            <polygon points="100,14 108,36 100,30 92,36" fill="${color}"/>
          </g>
          <text x="100" y="104" text-anchor="middle" font-size="26" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="#f4f7fa">${speed}</text>
          <text x="100" y="120" text-anchor="middle" font-size="9" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#9aa7b4">${m.unit.toUpperCase()}</text>
          <text x="100" y="136" text-anchor="middle" font-size="11" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="${color}">${m.calm ? "CALM" : m.cardinal}</text>
        </svg>
      `;
    }

    _svgModern(m) {
      const deg = m.heading == null ? 0 : m.heading;
      const color = needleColor(m.live);
      const uid = `m${Math.abs(this.config?.entity?.length || 1)}`;
      const max = m.maxSpeed;
      const frac = Math.max(0, Math.min(1, (m.live || 0) / max));
      const circ = 2 * Math.PI * 82;
      const dash = (frac * circ).toFixed(2);
      let ticks = "";
      for (let a = 0; a < 360; a += 15) {
        const rad = ((a - 90) * Math.PI) / 180;
        const major = a % 90 === 0;
        const outer = 88;
        const inner = major ? 76 : 82;
        ticks += `<line x1="${(100 + Math.cos(rad) * outer).toFixed(2)}" y1="${(100 + Math.sin(rad) * outer).toFixed(2)}" x2="${(100 + Math.cos(rad) * inner).toFixed(2)}" y2="${(100 + Math.sin(rad) * inner).toFixed(2)}" stroke="${major ? "#eaf4ff" : "#5b6b78"}" stroke-width="${major ? 2.2 : 1.2}" stroke-linecap="round"/>`;
      }
      const dirs = [
        [0, "N"],
        [90, "E"],
        [180, "S"],
        [270, "W"],
      ]
        .map(([a, t]) => {
          const rad = ((a - 90) * Math.PI) / 180;
          const x = (100 + Math.cos(rad) * 62).toFixed(2);
          const y = (100 + Math.sin(rad) * 62 + 5).toFixed(2);
          return `<text x="${x}" y="${y}" text-anchor="middle" font-size="13" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="${a === 0 ? "#ff8a8a" : "#d5dee6"}">${t}</text>`;
        })
        .join("");
      const needleOp = m.calm ? 0.3 : 1;
      const speed = formatSpeed(m.live, m.unit);
      return `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="${uid}-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#7ecfff"/>
              <stop offset="100%" stop-color="${color}"/>
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="94" fill="#141a20" stroke="#2a343d" stroke-width="2"/>
          <circle cx="100" cy="100" r="82" fill="none" stroke="#243038" stroke-width="8"/>
          <circle cx="100" cy="100" r="82" fill="none" stroke="url(#${uid}-arc)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${dash} ${circ.toFixed(2)}" transform="rotate(-90 100 100)"/>
          ${ticks}
          ${dirs}
          <g transform="rotate(${deg} 100 100)" opacity="${needleOp}">
            <polygon points="100,18 107,46 100,40 93,46" fill="${color}"/>
            <line x1="100" y1="46" x2="100" y2="78" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
          </g>
          <text x="100" y="104" text-anchor="middle" font-size="28" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="#f4f7fa">${speed}</text>
          <text x="100" y="120" text-anchor="middle" font-size="9" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#9aa7b4">${m.unit.toUpperCase()}</text>
          <text x="100" y="136" text-anchor="middle" font-size="11" font-weight="800" font-family="Arial, Helvetica, sans-serif" fill="${color}">${m.calm ? "CALM" : m.cardinal}</text>
        </svg>
      `;
    }

    static get styles() {
      return css`
        :host {
          display: block;
        }
        :host([data-size="75"]) {
          zoom: 0.75;
        }
        :host([data-size="50"]) {
          zoom: 0.5;
        }
        ha-card {
          overflow: hidden;
          background: var(--card-background-color, var(--ha-card-background));
        }
        .wrap {
          padding: 12px 14px 14px;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .setup {
          min-height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--secondary-text-color);
        }
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .title {
          border: 0;
          background: none;
          padding: 0;
          font-size: 1.05rem;
          font-weight: 650;
          color: var(--primary-text-color);
          cursor: pointer;
          text-align: left;
        }
        .badge {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          padding: 3px 8px;
          border-radius: 999px;
          white-space: nowrap;
        }
        .badge.wind {
          color: #dff6ff;
          background: #0b6aa2;
        }
        .badge.calm {
          color: var(--secondary-text-color);
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
        }
        .badge.warn {
          color: #3b1d00;
          background: #f8c15c;
        }
        .body {
          display: grid;
          grid-template-columns: minmax(150px, 0.95fr) minmax(220px, 1.2fr);
          gap: 10px 16px;
          align-items: stretch;
        }
        .gauge-col {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .compass {
          width: 100%;
          max-width: 240px;
        }
        .compass-svg,
        .compass-svg svg {
          width: 100%;
          height: auto;
          display: block;
          filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.28));
        }
        .info-col {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .tiles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .tile {
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.1));
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.04));
          color: var(--primary-text-color);
          border-radius: 12px;
          padding: 12px 12px 11px;
          text-align: left;
          cursor: pointer;
        }
        .tile-k {
          display: block;
          font-size: 0.72rem;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 650;
        }
        .tile-v {
          display: block;
          margin-top: 4px;
          font-size: 1.35rem;
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }
        .tile-v small {
          margin-left: 4px;
          font-size: 0.72rem;
          font-weight: 650;
          color: var(--secondary-text-color);
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .stat {
          display: flex;
          flex-direction: column;
          min-width: 0;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.1));
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.04));
          border-radius: 12px;
          padding: 10px 10px 9px;
        }
        .stat-k {
          font-size: 0.7rem;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 650;
        }
        .stat-v {
          font-size: 0.98rem;
          font-weight: 650;
        }
        .hist {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .hist-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
        }
        .hist-title {
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--secondary-text-color);
        }
        .pills {
          display: flex;
          gap: 4px;
        }
        .pill {
          border: 0;
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
          color: var(--secondary-text-color);
          font-size: 0.72rem;
          font-weight: 700;
          border-radius: 999px;
          padding: 3px 8px;
          cursor: pointer;
        }
        .pill.on {
          background: #0b6aa2;
          color: #fff;
        }
        .chart {
          display: flex;
          align-items: stretch;
          gap: 3px;
          flex: 1;
          min-height: 148px;
          padding: 6px 0 0;
        }
        .bar-col {
          flex: 1;
          min-width: 0;
          border: 0;
          background: none;
          padding: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          cursor: pointer;
          height: 100%;
        }
        .bar {
          width: 70%;
          max-width: 14px;
          border-radius: 4px 4px 2px 2px;
          background: rgba(127, 199, 255, 0.28);
          display: block;
        }
        .bar-col.wet .bar {
          background: linear-gradient(180deg, #7ecfff 0%, #1a8fd4 100%);
        }
        .bar-col.sel .bar {
          outline: 2px solid #e8f7ff;
          outline-offset: 1px;
        }
        .bar-l {
          margin-top: 4px;
          font-size: 0.62rem;
          color: var(--secondary-text-color);
          line-height: 1;
          min-height: 0.7rem;
          white-space: nowrap;
        }
        .chart.dense {
          gap: 2px;
        }
        .chart.dense .bar {
          width: 90%;
          max-width: 10px;
        }
        .hist-foot {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-top: 6px;
          font-size: 0.78rem;
          color: var(--secondary-text-color);
        }
        .hist-err {
          margin-top: 4px;
          font-size: 0.75rem;
          color: var(--error-color, #f87171);
        }
        @media (max-width: 520px) {
          .body {
            grid-template-columns: 1fr;
          }
          .compass {
            max-width: 200px;
            margin: 0 auto;
          }
          .chart {
            min-height: 110px;
          }
        }
      `;
    }
  }

  class WindPlusCardEditor extends LitElement {
    static get properties() {
      return { hass: {}, config: {} };
    }

    setConfig(config) {
      this.config = mergeConfig(config || {});
    }

    _valueChanged(ev) {
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: ev.detail.value },
        })
      );
    }

    render() {
      if (!this.hass) return html``;
      const merged = mergeConfig(this.config || {});
      return html`
        <ha-form
          .hass=${this.hass}
          .data=${merged}
          .schema=${[
            { name: "name", selector: { text: {} } },
            {
              name: "look",
              selector: {
                select: {
                  mode: "dropdown",
                  options: Object.keys(LOOKS).map((value) => ({
                    value,
                    label: LOOKS[value].label,
                  })),
                },
              },
            },
            {
              name: "size",
              selector: {
                select: {
                  mode: "dropdown",
                  options: [
                    { value: "100", label: "Full (100%)" },
                    { value: "75", label: "75%" },
                    { value: "50", label: "50%" },
                  ],
                },
              },
            },
            {
              name: "entity",
              selector: {
                entity: {
                  domain: "sensor",
                  device_class: "wind_speed",
                },
              },
            },
            {
              name: "direction_entity",
              selector: { entity: { domain: "sensor" } },
            },
            {
              name: "gust_entity",
              selector: {
                entity: {
                  domain: "sensor",
                  device_class: "wind_speed",
                },
              },
            },
            {
              name: "max_speed",
              selector: {
                number: { min: 10, max: 150, step: 5, mode: "box" },
              },
            },
            {
              name: "unit_system",
              selector: {
                select: {
                  options: [
                    { value: "auto", label: "Auto (from sensor)" },
                    { value: "imperial", label: "mph" },
                    { value: "metric", label: "km/h" },
                    { value: "ms", label: "m/s" },
                    { value: "knots", label: "Knots" },
                  ],
                },
              },
            },
            {
              name: "history_days",
              selector: {
                select: {
                  mode: "dropdown",
                  options: [
                    { value: "7", label: "7 days" },
                    { value: "14", label: "14 days" },
                    { value: "30", label: "30 days" },
                  ],
                },
              },
            },
            { name: "show_history", selector: { boolean: {} } },
            { name: "show_gust", selector: { boolean: {} } },
          ]}
          .computeLabel=${(s) =>
            ({
              name: "Card title",
              look: "Compass look",
              size: "Card size",
              entity: "Wind speed",
              direction_entity: "Wind direction / heading",
              gust_entity: "Wind gust (optional)",
              max_speed: "Dial full scale (modern look)",
              unit_system: "Display units",
              history_days: "Default history range",
              show_history: "Show daily peak history",
              show_gust: "Show gust",
            })[s.name] || s.name}
          @value-changed=${this._valueChanged}
        ></ha-form>
      `;
    }
  }

  customElements.define("wind-plus-card", WindPlusCard);
  customElements.define("wind-plus-card-editor", WindPlusCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "wind-plus-card",
    name: "Wind Plus",
    description: "Compass wind card with speed, direction, and daily history",
    preview: true,
    documentationURL: "https://github.com/randrcomputers/ha-wind-card#readme",
  });
})();

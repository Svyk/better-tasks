// Pure recurrence + date parsing engine for Better Tasks.
// Extracted verbatim from src/index.js so it can be unit-tested in Node at
// build time. This module must stay free of Roam/DOM dependencies: the only
// browser touchpoints (roamAlphaAPI date utils) are feature-detected and fall
// back to pure implementations. Impure call sites in index.js (settings
// lookup, parse-failure toasts) inject their behaviour via parameters/hooks.

export const DOW_MAP = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};
export const DOW_IDX = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export const ORD_MAP = { "1st": 1, "first": 1, "2nd": 2, "second": 2, "3rd": 3, "third": 3, "4th": 4, "fourth": 4, "last": -1 };
export const DOW_ALIASES = {
  su: "sunday",
  sun: "sunday",
  sunday: "sunday",
  mo: "monday",
  mon: "monday",
  monday: "monday",
  tu: "tuesday",
  tue: "tuesday",
  tues: "tuesday",
  tuesday: "tuesday",
  we: "wednesday",
  wed: "wednesday",
  wednesday: "wednesday",
  th: "thursday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  thursday: "thursday",
  fr: "friday",
  fri: "friday",
  friday: "friday",
  sa: "saturday",
  sat: "saturday",
  saturday: "saturday",
};
export const DOW_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
export const DEFAULT_WEEK_START_CODE = "MO";
export const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
export const MONTH_KEYWORD_INTERVAL_LOOKUP = {
  quarterly: 3,
  "every quarter": 3,
  semiannual: 6,
  "semi annual": 6,
  semiannually: 6,
  "semi annually": 6,
  "semi-annual": 6,
  "semi-annually": 6,
  "twice a year": 6,
  "twice-a-year": 6,
  "twice-per-year": 6,
  "twice per year": 6,
};

// Injectable clock — production always uses the real clock; tests may pin
// "now" to make date arithmetic deterministic.
let nowProvider = () => new Date();
export function __setNowProviderForTests(fn) {
  nowProvider = typeof fn === "function" ? fn : () => new Date();
}

// ========================= Token helpers =========================

export function ordFromText(value) {
  if (!value) return null;
  const numeric = Number(value.replace(/(st|nd|rd|th)$/i, ""));
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= 31) return numeric;
  return ORD_MAP[value.toLowerCase()] ?? null;
}

export function dowFromAlias(token) {
  if (!token) return null;
  const norm = (DOW_ALIASES[token.toLowerCase()] || token).toLowerCase();
  return DOW_MAP[norm] || null;
}

export function normalizeWeekStartCode(value) {
  if (typeof value === "string") {
    const code = dowFromAlias(value);
    if (code) return code;
  }
  if (typeof value === "string" && DOW_ORDER.includes(value.toUpperCase())) {
    return value.toUpperCase();
  }
  return DEFAULT_WEEK_START_CODE;
}

export function getDowOrderForWeekStart(weekStartCode) {
  const code = weekStartCode && DOW_ORDER.includes(weekStartCode) ? weekStartCode : DEFAULT_WEEK_START_CODE;
  const idx = DOW_ORDER.indexOf(code);
  if (idx <= 0) return DOW_ORDER;
  return [...DOW_ORDER.slice(idx), ...DOW_ORDER.slice(0, idx)];
}

export function getOrderedWeekdayOffsets(byDay, weekStartCode) {
  const order = getDowOrderForWeekStart(weekStartCode);
  const seen = new Set();
  const offsets = [];
  for (const code of Array.isArray(byDay) ? byDay : []) {
    if (typeof code !== "string") continue;
    const idx = order.indexOf(code);
    if (idx === -1 || seen.has(code)) continue;
    seen.add(code);
    offsets.push(idx);
  }
  offsets.sort((a, b) => a - b);
  return offsets;
}

export function monthFromText(x) {
  if (!x) return null;
  const m = MONTH_MAP[x.toLowerCase()];
  return m || null;
}

export function expandDowRange(startISO, endISO, dowOrder = DOW_ORDER) {
  const s = dowOrder.indexOf(startISO), e = dowOrder.indexOf(endISO);
  if (s === -1 || e === -1) return [];
  if (s <= e) return dowOrder.slice(s, e + 1);
  return [...dowOrder.slice(s), ...dowOrder.slice(0, e + 1)]; // wrap
}

export function splitList(str) {
  return str
    .replace(/&/g, ",")
    .replace(/\band\b/gi, ",")
    .split(/[,\s/]+/)
    .filter(Boolean);
}

// Recognize MWF / TTh sets
export function parseAbbrevSet(token) {
  const t = token.toLowerCase();
  if (t === "mwf") return ["MO", "WE", "FR"];
  if (t === "tth" || t === "tu/th" || t === "t/th") return ["TU", "TH"];
  return null;
}

// Turn mixed text, ranges, and shorthands into ISO DOW array
export function normalizeByDayList(raw, weekStartCode = DEFAULT_WEEK_START_CODE) {
  const tokens = splitList(raw.replace(/[-–—]/g, "-"));
  const dowOrder = getDowOrderForWeekStart(weekStartCode);
  let out = [];
  for (const tok of tokens) {
    if (tok.includes("-")) {
      const [a, b] = tok.split("-");
      const A = dowFromAlias(a), B = dowFromAlias(b);
      if (A && B) { out.push(...expandDowRange(A, B, dowOrder)); continue; }
    }
    const set = parseAbbrevSet(tok);
    if (set) { out.push(...set); continue; }
    const d = dowFromAlias(tok);
    if (d) { out.push(d); continue; }
  }
  const seen = new Set();
  return out.filter(d => (seen.has(d) ? false : (seen.add(d), true)));
}

export function keywordIntervalFromText(text) {
  return MONTH_KEYWORD_INTERVAL_LOOKUP[text] || null;
}

// ========================= Date utils =========================

export function todayLocal() {
  const d = new Date(nowProvider().getTime());
  d.setHours(12, 0, 0, 0); // noon to dodge DST edges
  return d;
}
export function startOfDayLocal(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
export function addDaysLocal(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}
export function addMonthLocal(d, n) {
  const targetMonth = d.getMonth() + n;
  const maxDay = new Date(d.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(d.getFullYear(), targetMonth, Math.min(d.getDate(), maxDay), 12, 0, 0, 0);
}
export function startOfWeek(date, weekStartCode) {
  const target = weekStartCode && DOW_IDX.includes(weekStartCode) ? weekStartCode : DEFAULT_WEEK_START_CODE;
  let cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  for (let i = 0; i < 7 && DOW_IDX[cursor.getDay()] !== target; i++) {
    cursor = addDaysLocal(cursor, -1);
  }
  return cursor;
}
export function isWeekend(d) {
  const w = d.getDay(); // 0 Sun .. 6 Sat
  return w === 0 || w === 6;
}
export function nextDowDate(anchor, dowCode) {
  if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime())) return null;
  if (!dowCode || !DOW_IDX.includes(dowCode)) return null;
  const current = DOW_IDX[anchor.getDay()];
  const curIdx = DOW_IDX.indexOf(current);
  const targetIdx = DOW_IDX.indexOf(dowCode);
  let delta = targetIdx - curIdx;
  if (delta <= 0) delta += 7;
  return addDaysLocal(anchor, delta);
}

export function clampDayInMonth(year, monthIndex, desired) {
  const lastDay = new Date(year, monthIndex + 1, 0, 12, 0, 0, 0).getDate();
  const numeric = Number.isFinite(desired) ? Math.trunc(desired) : lastDay;
  if (numeric < 1) return 1;
  if (numeric > lastDay) return lastDay;
  return numeric;
}

export function applyOffsetToDate(base, offsetMs) {
  if (!(base instanceof Date) || Number.isNaN(base.getTime())) return null;
  if (!Number.isFinite(offsetMs)) return null;
  const next = new Date(base.getTime() + offsetMs);
  next.setHours(12, 0, 0, 0);
  return next;
}

export function advanceMonth(year, monthIndex, step) {
  let nextMonth = monthIndex + step;
  let nextYear = year;
  while (nextMonth > 11) {
    nextMonth -= 12;
    nextYear += 1;
  }
  while (nextMonth < 0) {
    nextMonth += 12;
    nextYear -= 1;
  }
  return { year: nextYear, month: nextMonth };
}

// ========================= Roam / relative date parsing =========================

export function parseRoamDate(s) {
  if (!s) return null;
  const raw = String(s).trim();

  // 1) [[YYYY-MM-DD]] or bare YYYY-MM-DD
  let m = raw.match(/^\[\[(\d{4})-(\d{2})-(\d{2})\]\]$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00`);

  // 2) [[DNP title]] e.g. [[November 5th, 2025]] or bare DNP title "November 5th, 2025"
  const dnpTitle = raw.startsWith("[[") && raw.endsWith("]]") ? raw.slice(2, -2) : raw;

  // Prefer Roam's converter if available
  const util = typeof window !== "undefined" ? window.roamAlphaAPI?.util : undefined;
  if (util?.pageTitleToDate) {
    try {
      const dt = util.pageTitleToDate(dnpTitle);
      if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
        // Normalize to noon to dodge DST edges
        dt.setHours(12, 0, 0, 0);
        return dt;
      }
    } catch (_) { }
  }

  // Fallback: strip ordinal ("st/nd/rd/th") and parse "Month Day, Year"
  const cleaned = dnpTitle.replace(/\b(\d{1,2})(st|nd|rd|th)\b/i, "$1");
  const parsed = new Date(`${cleaned} 12:00:00`);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return null;
}

export function stripTimeFromDateText(text) {
  if (!text || typeof text !== "string") return text;
  let t = text.trim();
  // strip "at 3pm" or "at 15:30"
  t = t.replace(/\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i, "");
  // strip trailing "3pm" or "15:30" (require am/pm or colon to avoid stripping "in 3 days")
  t = t.replace(/\s+\d{1,2}:\d{2}\s*(am|pm)?\b/i, "");
  t = t.replace(/\s+\d{1,2}\s*(am|pm)\b/i, "");
  // strip time-of-day words
  t = t
    .replace(/\b(morning|afternoon|evening|night)\b/gi, "")
    .replace(/\b(before|by)\s*\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, "")
    .replace(/\b(before|by)\s+lunch\b/gi, "")
    .replace(/\blunch\b/gi, "")
    .replace(/\b(noon|midnight)\b/gi, "")
    .replace(/\b(end of day|eod)\b/gi, "")
    .replace(/\bat\b\s*$/gi, "")
    .trim();
  // strip leading "every "
  t = t.replace(/^\s*every\s+/i, "").trim();
  return t.trim();
}

export function hasTimeOnlyHint(text) {
  if (!text || typeof text !== "string") return false;
  const raw = text.toLowerCase();
  return (
    /\b(before|by)\s*\d{1,2}(:\d{2})?\s*(am|pm)?\b/.test(raw) ||
    /\b\d{1,2}(:\d{2})?\s*(am|pm)?\b/.test(raw) ||
    /\b(morning|afternoon|evening|night|end of day|eod|lunch)\b/.test(raw) ||
    /\b(before|by)\s+lunch\b/.test(raw) ||
    /\b(noon|midnight)\b/.test(raw)
  );
}

export function pickAnchorDateFromTimeHint(text, set) {
  if (!text || typeof text !== "string") return todayLocal();
  const raw = text.toLowerCase();
  const m =
    raw.match(/(before|by)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/) ||
    (/\bmorning\b/.test(raw) ? ["", "", "9", "00", "am"] : null) ||
    (/\bafternoon\b/.test(raw) ? ["", "", "14", "00", ""] : null) ||
    (/\bevening\b/.test(raw) ? ["", "", "18", "00", ""] : null) ||
    (/\bnight\b/.test(raw) ? ["", "", "20", "00", ""] : null) ||
    (/\b(end of day|eod)\b/.test(raw) ? ["", "", "17", "00", ""] : null) ||
    (/\blunch\b/.test(raw) ? ["", "", "12", "30", ""] : null) ||
    (/\bnoon\b/.test(raw) ? ["", "", "12", "00", ""] : null) ||
    (/\bmidnight\b/.test(raw) ? ["", "", "00", "00", ""] : null);
  if (!m) return todayLocal();
  let hour = parseInt(m[2], 10);
  const minute = m[3] ? parseInt(m[3], 10) : 0;
  const suffix = m[4]?.toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  const now = nowProvider();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  const anchor = now.getTime() <= target.getTime() ? todayLocal() : addDaysLocal(todayLocal(), 1);
  return anchor;
}

export function parseWeekSpan(text, set) {
  if (!text || typeof text !== "string") return null;
  const raw = text.toLowerCase();
  if (!/\b(this week|sometime this week|later this week|start of this week|end of the week|end of week|before the end of the week)\b/.test(raw))
    return null;
  const start = startOfWeek(todayLocal(), set?.weekStartCode);
  const due = addDaysLocal(start, 6);
  return { start, due };
}

export function parseWeekendSpan(text, set) {
  if (!text || typeof text !== "string") return null;
  const raw = text.toLowerCase();
  if (!/\b(this weekend|next weekend)\b/.test(raw)) return null;
  const now = nowProvider();
  const dow = now.getDay(); // 0 Sun .. 6 Sat
  const baseStart = startOfWeek(todayLocal(), set?.weekStartCode);
  const isLateSunday = raw.includes("this weekend") && dow === 0 && now.getHours() >= 12;
  const weekOffset = raw.includes("next weekend") || isLateSunday ? 7 : 0;
  const saturday = addDaysLocal(baseStart, weekOffset + 5);
  const sunday = addDaysLocal(saturday, 1);
  return { start: saturday, due: sunday };
}

export function parseRelativeDateText(s, weekStartCode = DEFAULT_WEEK_START_CODE) {
  if (!s || typeof s !== "string") return null;
  let raw = s.trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("[[") && raw.endsWith("]]")) {
    raw = raw.slice(2, -2).trim();
  }
  // Compact offset: +3d, +2w, +1m
  const compactOffsetMatch = raw.match(/^\+(\d+)\s*(d|w|m)$/);
  if (compactOffsetMatch) {
    const n = parseInt(compactOffsetMatch[1], 10);
    const unit = compactOffsetMatch[2];
    if (unit === "d") return addDaysLocal(todayLocal(), n);
    if (unit === "w") return addDaysLocal(todayLocal(), n * 7);
    if (unit === "m") {
      const now = todayLocal();
      const targetMonth = now.getMonth() + n;
      const maxDay = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
      return new Date(now.getFullYear(), targetMonth, Math.min(now.getDate(), maxDay), 12, 0, 0, 0);
    }
  }
  if (raw === "today") return todayLocal();
  if (/^tomor+ow$/.test(raw) || raw === "tmr" || raw === "tmrw") {
    return addDaysLocal(todayLocal(), 1);
  }
  if (raw === "tonight") {
    return todayLocal();
  }
  if (raw === "next month") {
    const now = todayLocal();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = new Date(y, m + 1, 1, 12, 0, 0, 0);
    return d;
  }
  const nextMonthMatch = raw.match(/^(early|mid|late)\s+next\s+([a-z]+)$/);
  if (nextMonthMatch) {
    const descriptor = nextMonthMatch[1];
    const monthName = nextMonthMatch[2];
    const monthIndex = MONTH_MAP[monthName];
    if (monthIndex != null) {
      const now = todayLocal();
      const year = now.getFullYear() + (monthIndex - 1 < now.getMonth() ? 1 : 0);
      const day = descriptor === "early" ? 5 : descriptor === "mid" ? 15 : 25;
      return new Date(year, monthIndex - 1, day, 12, 0, 0, 0);
    }
  }
  const earlyMonthMatch = raw.match(/^(?:early|mid|late)\s+([a-z]+)$/);
  if (earlyMonthMatch) {
    const monthName = earlyMonthMatch[1];
    const monthIndex = MONTH_MAP[monthName];
    if (monthIndex != null) {
      const now = todayLocal();
      const year = now.getFullYear() + (monthIndex - 1 < now.getMonth() ? 1 : 0);
      const day = raw.startsWith("early") ? 5 : raw.startsWith("mid") ? 15 : 25;
      return new Date(year, monthIndex - 1, day, 12, 0, 0, 0);
    }
  }
  const nextWeekMatch = raw.match(/^(early|mid|late)\s+next\s+week$/);
  if (nextWeekMatch) {
    const descriptor = nextWeekMatch[1];
    const anchor = addDaysLocal(startOfWeek(todayLocal(), weekStartCode), 7);
    if (descriptor === "early") return anchor;
    if (descriptor === "mid") return addDaysLocal(anchor, 3);
    return addDaysLocal(anchor, 5);
  }
  if (raw === "next week") {
    const anchor = todayLocal();
    const thisWeekStart = startOfWeek(anchor, weekStartCode);
    return addDaysLocal(thisWeekStart, 7);
  }
  const thisWeekMatch = raw.match(/^(?:sometime|later|early)\s+this\s+week$/);
  if (thisWeekMatch) {
    const anchor = startOfWeek(todayLocal(), weekStartCode);
    if (/early/.test(raw)) return anchor;
    if (/later/.test(raw)) return addDaysLocal(anchor, 4);
    return anchor;
  }
  const thisDowMatch = raw.match(/^this\s+([a-z]+)$/);
  if (thisDowMatch) {
    const dowCode = dowFromAlias(thisDowMatch[1]);
    if (dowCode) {
      const today = todayLocal();
      const todayIdx = today.getDay(); // 0 Sun .. 6 Sat
      const targetIdx = DOW_IDX.indexOf(dowCode);
      let delta = targetIdx - todayIdx;
      if (delta <= 0) delta += 7;
      return addDaysLocal(today, delta);
    }
  }
  const theFirstMatch = raw.match(/^the\s+first(?:\s+of)?\s+every\s+month$/);
  if (theFirstMatch) {
    const now = todayLocal();
    const y = now.getFullYear();
    const m = now.getMonth();
    const todayDay = now.getDate();
    // if past the first, move to next month
    const targetMonth = todayDay > 1 ? m + 1 : m;
    return new Date(y, targetMonth, 1, 12, 0, 0, 0);
  }
  const nextDowMatch = raw.match(/^next\s+([a-z]+)$/);
  if (nextDowMatch) {
    const dowCode = dowFromAlias(nextDowMatch[1]);
    if (dowCode) return nextDowDate(todayLocal(), dowCode);
  }
  const weekdayCode = dowFromAlias(raw);
  if (weekdayCode) return nextDowDate(todayLocal(), weekdayCode);
  if (raw === "this weekend") {
    const now = nowProvider();
    const dow = now.getDay(); // 0 Sun .. 6 Sat
    if (dow === 0 && now.getHours() >= 12) {
      const anchorNext = addDaysLocal(startOfWeek(todayLocal(), weekStartCode), 7);
      return addDaysLocal(anchorNext, 5);
    }
    const anchor = startOfWeek(todayLocal(), weekStartCode);
    // weekend = Saturday of this week
    return addDaysLocal(anchor, 5);
  }
  if (raw === "next weekend") {
    const anchor = addDaysLocal(startOfWeek(todayLocal(), weekStartCode), 7);
    return addDaysLocal(anchor, 5);
  }

  // "in N days/weeks/months"
  const inNMatch = raw.match(/^in\s+(\d+)\s+(days?|weeks?|months?)$/);
  if (inNMatch) {
    const n = parseInt(inNMatch[1], 10);
    const unit = inNMatch[2].replace(/s$/, "");
    if (unit === "day") return addDaysLocal(todayLocal(), n);
    if (unit === "week") return addDaysLocal(todayLocal(), n * 7);
    if (unit === "month") {
      const now = todayLocal();
      const targetMonth = now.getMonth() + n;
      const maxDay = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
      return new Date(now.getFullYear(), targetMonth, Math.min(now.getDate(), maxDay), 12, 0, 0, 0);
    }
  }

  // "N days/weeks/months from now"
  const fromNowMatch = raw.match(/^(\d+)\s+(days?|weeks?|months?)\s+from\s+now$/);
  if (fromNowMatch) {
    const n = parseInt(fromNowMatch[1], 10);
    const unit = fromNowMatch[2].replace(/s$/, "");
    if (unit === "day") return addDaysLocal(todayLocal(), n);
    if (unit === "week") return addDaysLocal(todayLocal(), n * 7);
    if (unit === "month") {
      const now = todayLocal();
      const targetMonth = now.getMonth() + n;
      const maxDay = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
      return new Date(now.getFullYear(), targetMonth, Math.min(now.getDate(), maxDay), 12, 0, 0, 0);
    }
  }

  // "end of week" / "end of this week"
  if (/^end\s+of\s+(the\s+|this\s+)?week$/.test(raw)) {
    const ws = startOfWeek(todayLocal(), weekStartCode);
    return addDaysLocal(ws, 6);
  }

  // "end of month" / "end of this month"
  if (/^end\s+of\s+(the\s+|this\s+)?month$/.test(raw)) {
    const now = todayLocal();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0, 12, 0, 0, 0);
  }

  // "end of year" / "end of this year"
  if (/^end\s+of\s+(the\s+|this\s+)?year$/.test(raw)) {
    return new Date(todayLocal().getFullYear(), 11, 31, 12, 0, 0, 0);
  }

  return null;
}

export function toDnpTitle(d) {
  const util = typeof window !== "undefined" ? window.roamAlphaAPI?.util : undefined;
  if (util?.dateToPageTitle) {
    try {
      return util.dateToPageTitle(d);
    } catch (err) {
      console.warn("[RecurringTasks] dateToPageTitle failed, falling back to ISO", err);
    }
  }
  // Fallback: ISO style
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDate(d, set) {
  if (set.dateFormat === "ISO") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }
  // ROAM: always link to the Daily Note Page title, e.g. [[November 5th, 2025]]
  const title = toDnpTitle(d);
  return `[[${title}]]`;
}

export function parseDateFromText(value, set) {
  if (typeof value !== "string" || !value.trim()) return { date: null, text: null };
  const original = value.trim();
  const cleaned = stripTimeFromDateText(original);
  let dt = parseRoamDate(cleaned) || parseRelativeDateText(cleaned, set.weekStartCode);
  if (!dt && hasTimeOnlyHint(original)) {
    dt = pickAnchorDateFromTimeHint(original, set);
  }
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return { date: null, text: null };
  return { date: dt, text: formatDate(dt, set) };
}

// ========================= Repeat rule parsing =========================

// === Merged + extended parser ===
export function parseRuleText(s, options = {}) {
  if (!s) return null;
  const t = s.trim().replace(/\s+/g, " ").toLowerCase();
  const weekStartCode = normalizeWeekStartCode(options.weekStartCode || options.weekStart);
  const ordinalHint = /\b(first|second|third|fourth|fifth|last|other|day|month)\b/.test(t) || /\d/.test(t);
  if (!ordinalHint) {
    const quickSet = parseAbbrevSet(t);
    if (quickSet) return { kind: "WEEKLY", interval: 1, byDay: quickSet };
    const looseDays = normalizeByDayList(t, weekStartCode);
    if (looseDays.length) return { kind: "WEEKLY", interval: 1, byDay: looseDays };
  }

  const keywordInterval = keywordIntervalFromText(t);
  if (keywordInterval) {
    return { kind: "MONTHLY_DAY", interval: keywordInterval };
  }

  // 0) Simple daily & weekday/weekend anchors
  if (t === "daily" || t === "every day") return { kind: "DAILY", interval: 1 };
  if (
    t === "every other day" || t === "every second day" ||
    t === "every two days" || t === "second daily"
  ) return { kind: "DAILY", interval: 2 };
  if (t === "every third day" || t === "every three days") return { kind: "DAILY", interval: 3 };
  if (t === "every fourth day" || t === "every four days") return { kind: "DAILY", interval: 4 };
  if (t === "every fifth day" || t === "every five days") return { kind: "DAILY", interval: 5 };

  if (t === "every weekday" || t === "weekdays" || t === "on weekdays" || t === "business days" || t === "workdays")
    return { kind: "WEEKDAY" };
  if (t === "every weekend" || t === "weekend" || t === "weekends")
    return { kind: "WEEKLY", interval: 1, byDay: ["SA", "SU"] };

  // 1) "every <dow>" (singular/plural) — use your DOW_MAP and aliases
  const singleDow = Object.keys(DOW_ALIASES).find(
    a => t === `every ${a}` || t === `every ${a}s`
  );
  if (singleDow) return { kind: "WEEKLY", interval: 1, byDay: [dowFromAlias(singleDow)] };

  // 2) "every N days"
  let m = t.match(/^every (\d+)\s*days?$/);
  if (m) return { kind: "DAILY", interval: parseInt(m[1], 10) };

  // 3) "every N weekdays/business days"
  m = t.match(/^every (\d+)\s*(?:weekdays?|business days?)$/);
  if (m) return { kind: "BUSINESS_DAILY", interval: parseInt(m[1], 10) };

  // 4) Weekly base words + biweekly/fortnightly
  if (t === "weekly" || t === "every week") return { kind: "WEEKLY", interval: 1, byDay: null };
  if (t === "every other week" || t === "every second week" || t === "biweekly" || t === "fortnightly" || t === "every fortnight")
    return { kind: "WEEKLY", interval: 2, byDay: null };
  m = t.match(/^every\s+(other|second|2nd)\s+([a-z]+)s?$/);
  if (m) {
    const dowCode = dowFromAlias(m[2]);
    if (dowCode) return { kind: "WEEKLY", interval: 2, byDay: [dowCode] };
  }
  m = t.match(/^every\s+(\d+)(?:st|nd|rd|th)?\s+([a-z]+)s?$/);
  if (m) {
    const intervalNum = parseInt(m[1], 10);
    const dowCode = dowFromAlias(m[2]);
    if (dowCode && intervalNum >= 1) {
      if (intervalNum === 1) return { kind: "WEEKLY", interval: 1, byDay: [dowCode] };
      return { kind: "WEEKLY", interval: intervalNum, byDay: [dowCode] };
    }
  }

  // 5) Weekly with "on …"
  let weeklyOn = t.match(/^(?:every week|weekly)\s+on\s+(.+)$/);
  if (weeklyOn) {
    const byDay = normalizeByDayList(weeklyOn[1], weekStartCode);
    return { kind: "WEEKLY", interval: 1, byDay: byDay.length ? byDay : null };
  }
  // 5b) "every N weeks (on …)?"
  m = t.match(/^every (\d+)\s*weeks?(?:\s*on\s*(.+))?$/);
  if (m) {
    const interval = parseInt(m[1], 10);
    const byDay = m[2] ? normalizeByDayList(m[2], weekStartCode) : null;
    return { kind: "WEEKLY", interval, byDay: (byDay && byDay.length) ? byDay : null };
  }
  // 5c) "weekly on …"
  m = t.match(/^weekly on (.+)$/);
  if (m) {
    const byDay = normalizeByDayList(m[1], weekStartCode);
    if (byDay.length) return { kind: "WEEKLY", interval: 1, byDay };
  }
  // 5d) Bare "every <list/range/shorthand>"
  // Skipped when the phrase mentions months/years so monthly/yearly patterns
  // below (e.g. "every 2 months on the first monday") aren't shadowed by a
  // weekday name appearing later in the string.
  if (t.startsWith("every ")) {
    const after = t.slice(6).trim();
    if (!/\b(months?|years?)\b/.test(after)) {
      const byDay = normalizeByDayList(after, weekStartCode);
      if (byDay.length) return { kind: "WEEKLY", interval: 1, byDay };
    }
    // also accept "every monday(s)" etc. via your earlier path already handled above
  }

  // 6) Monthly: explicit EOM
  if (
    t === "last day of the month" ||
    t === "last day of each month" ||
    t === "last day of every month" ||
    t === "last day each month" ||
    t === "last day every month" ||
    t === "eom"
  )
    return { kind: "MONTHLY_LAST_DAY" };

  // 7) Monthly: semimonthly / multi-day
  m = t.match(/^(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*(?:,|and|&)\s*(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:each|every)\s+month$/);
  if (m) {
    const d1 = parseInt(m[1], 10), d2 = parseInt(m[2], 10);
    return { kind: "MONTHLY_MULTI_DAY", days: [d1, d2] };
  }
  m = t.match(/^(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+and\s+last\s+day\s+(?:of\s+)?(?:each|every)\s+month$/);
  if (m) {
    const d = parseInt(m[1], 10);
    return { kind: "MONTHLY_MIXED_DAY", days: [d], last: true };
  }
  m = t.match(/^on\s+the\s+(.+)\s+of\s+(?:each|every)\s+month$/);
  if (m) {
    const parts = splitList(m[1].replace(/\b(?:and|&)\b/g, ","));
    const days = parts
      .map(x => x.replace(/(st|nd|rd|th)$/i, ""))
      .map(x => parseInt(x, 10))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 31);
    if (days.length >= 1) return { kind: "MONTHLY_MULTI_DAY", days };
  }

  // 8) Monthly: your existing single-day variants
  if (t === "monthly") return { kind: "MONTHLY_DAY", day: todayLocal().getDate() };
  m = t.match(/^every month on day (\d{1,2})$/);
  if (m) return { kind: "MONTHLY_DAY", day: parseInt(m[1], 10) };
  m = t.match(/^(?:the\s+)?(\d{1,2}|1st|2nd|3rd|4th)\s+day\s+of\s+(?:each|every)\s+month$/);
  if (m) return { kind: "MONTHLY_DAY", day: ordFromText(m[1]) };
  m = t.match(/^day\s+(\d{1,2})\s+(?:of|in)?\s*(?:each|every)\s+month$/);
  if (m) return { kind: "MONTHLY_DAY", day: parseInt(m[1], 10) };

  // 9) Monthly: ordinal weekday (incl. compact), plus penultimate/weekday
  m = t.match(/^(?:every month on the|on the|every month the|the)\s+(1st|first|2nd|second|3rd|third|4th|fourth|last)\s+([a-z]+)$/);
  if (m) {
    const nth = m[1].toLowerCase();
    const dow = dowFromAlias(m[2]);
    if (dow) return { kind: "MONTHLY_NTH", nth, dow };
  }
  m = t.match(/^(?:the\s+)?(1st|first|2nd|second|3rd|third|4th|fourth|last)\s+([a-z]+)\s+(?:of\s+)?(?:each|every)\s+month$/);
  if (m) {
    const nth = m[1].toLowerCase();
    const dow = dowFromAlias(m[2]);
    if (dow) return { kind: "MONTHLY_NTH", nth, dow };
  }
  m = t.match(/^(?:the\s+)?(1st|first|2nd|second|3rd|third|4th|fourth)\s+and\s+(1st|first|2nd|second|3rd|third|4th|fourth)\s+([a-z]+)\s+(?:of\s+)?(?:each|every)\s+month$/);
  if (m) {
    const nths = [m[1].toLowerCase(), m[2].toLowerCase()];
    const dow = dowFromAlias(m[3]);
    if (dow) return { kind: "MONTHLY_MULTI_NTH", nths, dow };
  }
  m = t.match(/^(?:second\s+last|penultimate)\s+([a-z]+)\s+(?:of\s+)?(?:each|every)\s+month$/);
  if (m) {
    const dow = dowFromAlias(m[1]);
    if (dow) return { kind: "MONTHLY_NTH_FROM_END", nth: 2, dow };
  }
  m = t.match(/^(first|last)\s+weekday\s+(?:of\s+)?(?:each|every)\s+month$/);
  if (m) return { kind: "MONTHLY_NTH_WEEKDAY", nth: m[1].toLowerCase() };

  // 10) Every N months (date or ordinal weekday)
  m = t.match(/^every (\d+)\s*months?(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?$/);
  if (m) {
    const interval = parseInt(m[1], 10);
    const day = m[2] ? parseInt(m[2], 10) : todayLocal().getDate();
    return { kind: "MONTHLY_DAY", interval, day };
  }
  m = t.match(/^every (\d+)\s*months?\s+on\s+the\s+(1st|first|2nd|second|3rd|third|4th|fourth|last)\s+([a-z]+)$/);
  if (m) {
    const interval = parseInt(m[1], 10);
    const nth = m[2].toLowerCase();
    const dow = dowFromAlias(m[3]);
    if (dow) return { kind: "MONTHLY_NTH", interval, nth, dow };
  }

  // 11) Quarterly / semiannual / annual synonyms
  const yearlyKeyword = t.match(/^(annually|yearly|every year)$/);
  if (yearlyKeyword) {
    return { kind: "YEARLY" };
  }

  // 12) Yearly: explicit month/day or ordinal weekday-in-month
  m = t.match(/^(?:every|each)\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m) {
    const month = monthFromText(m[1]);
    const day = parseInt(m[2], 10);
    if (month) return { kind: "YEARLY", month, day };
  }
  m = t.match(/^every\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = monthFromText(m[2]);
    if (month) return { kind: "YEARLY", month, day };
  }
  m = t.match(/^on\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(?:every\s+year|annually|yearly)$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = monthFromText(m[2]);
    if (month) return { kind: "YEARLY", month, day };
  }
  m = t.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m) {
    const month = monthFromText(m[1]);
    const day = parseInt(m[2], 10);
    if (month && day) return { kind: "YEARLY", month, day };
  }
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(?:every\s+year)?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = monthFromText(m[2]);
    if (month && day) return { kind: "YEARLY", month, day };
  }
  m = t.match(/^(?:the\s+)?(1st|first|2nd|second|3rd|third|4th|fourth|last)\s+([a-z]+)\s+of\s+([a-z]+)(?:\s+(?:every\s+year|annually|yearly))?$/);
  if (m) {
    const nth = m[1].toLowerCase();
    const dow = dowFromAlias(m[2]);
    const month = monthFromText(m[3]);
    if (dow && month) return { kind: "YEARLY_NTH", month, nth, dow };
  }

  // No match
  return null;
}

// ========================= Next-occurrence engine =========================

export function resolveMonthlyInterval(rule) {
  const raw = Number.parseInt(rule?.interval, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function resolveMonthlyDay(rule, meta) {
  if (Number.isInteger(rule?.day) && rule.day >= 1) return rule.day;
  const due = meta?.due instanceof Date && !Number.isNaN(meta.due.getTime()) ? meta.due : null;
  if (due) return due.getDate();
  return todayLocal().getDate();
}

// hooks: { onRuleParsed(meta), onRuleFailed(meta) } — index.js uses these to
// clear/raise the per-task "could not parse recurrence" toast state.
export function computeNextDue(meta, set, depth = 0, ruleOverride = null, hooks = null) {
  const rule = ruleOverride || parseRuleText(meta.repeat, set);
  if (rule) {
    hooks?.onRuleParsed?.(meta);
  }
  if (!rule) {
    console.warn(`[RecurringTasks] Unable to parse repeat rule "${meta.repeat}"`);
    hooks?.onRuleFailed?.(meta);
    return null;
  }
  const base = set.advanceFrom === "completion" ? todayLocal() : meta.due || todayLocal();
  let next = null;
  switch (rule.kind) {
    case "DAILY":
      next = addDaysLocal(base, rule.interval || 1);
      break;
    case "WEEKDAY":
      next = nextWeekday(base);
      break;
    case "WEEKLY":
      next = nextWeekly(base, rule, set);
      break;
    case "MONTHLY_DAY": {
      const interval = resolveMonthlyInterval(rule);
      const day = resolveMonthlyDay(rule, meta);
      next = nextMonthOnDay(base, day, interval);
      break;
    }
    case "MONTHLY_NTH": {
      const interval = resolveMonthlyInterval(rule);
      next = nextMonthOnNthDow(base, rule.nth, rule.dow, interval);
      break;
    }
    case "MONTHLY_LAST_DAY":
      next = nextMonthLastDay(base);
      break;
    case "MONTHLY_MULTI_DAY":
      next = nextMonthlyMultiDay(base, rule);
      break;
    case "MONTHLY_MIXED_DAY":
      next = nextMonthlyMixedDay(base, rule);
      break;
    case "MONTHLY_MULTI_NTH":
      next = nextMonthlyMultiNth(base, rule);
      break;
    case "MONTHLY_NTH_FROM_END":
      next = nextMonthlyNthFromEnd(base, rule);
      break;
    case "MONTHLY_NTH_WEEKDAY":
      next = nextMonthlyWeekday(base, rule);
      break;
    case "YEARLY":
      next = nextYearlyOnDay(base, rule, meta);
      break;
    case "YEARLY_NTH":
      next = nextYearlyNthDow(base, rule, meta);
      break;
    default:
      next = null;
  }
  if (!next) return null;
  // Skip exception dates (holidays, etc.) stored in rt.exceptions
  if (meta.exceptions?.length && depth < 36) {
    const nextIso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    const exSet = meta._exceptionSet || (meta._exceptionSet = new Set(meta.exceptions));
    if (exSet.has(nextIso)) {
      return computeNextDue({ ...meta, due: next }, set, depth + 1, ruleOverride, hooks);
    }
  }
  const today = todayLocal();
  if (next < today && depth < 36) {
    const updatedMeta = { ...meta, due: next };
    return computeNextDue(updatedMeta, set, depth + 1, ruleOverride, hooks);
  }
  return next;
}

export function nextWeekday(d) {
  let x = addDaysLocal(d, 1);
  while (isWeekend(x)) x = addDaysLocal(x, 1);
  return x;
}

export function nextWeekly(base, rule, set) {
  const interval = Math.max(1, rule.interval || 1);
  const weekStartCode =
    (set && (set.weekStartCode || normalizeWeekStartCode(set.weekStart))) || DEFAULT_WEEK_START_CODE;
  if (!rule.byDay || rule.byDay.length === 0) {
    return addDaysLocal(base, 7 * interval);
  }
  const offsets = getOrderedWeekdayOffsets(rule.byDay, weekStartCode);
  if (!offsets.length) return addDaysLocal(base, 7 * interval);
  const weekAnchor = startOfWeek(base, weekStartCode);
  for (const offset of offsets) {
    const candidate = addDaysLocal(weekAnchor, offset);
    if (candidate > base) return candidate;
  }
  const nextAnchor = addDaysLocal(weekAnchor, 7 * interval);
  return addDaysLocal(nextAnchor, offsets[0]);
}

export function nextMonthOnDay(base, day, interval = 1) {
  const step = Number.isFinite(interval) && interval > 0 ? Math.trunc(interval) : 1;
  let year = base.getFullYear();
  let monthIndex = base.getMonth();
  const currentMonthCandidate = new Date(year, monthIndex, clampDayInMonth(year, monthIndex, day), 12, 0, 0, 0);
  if (currentMonthCandidate > base && step === 1) return currentMonthCandidate;
  ({ year, month: monthIndex } = advanceMonth(year, monthIndex, step));
  const safeDay = clampDayInMonth(year, monthIndex, day);
  return new Date(year, monthIndex, safeDay, 12, 0, 0, 0);
}

export function nextMonthOnNthDow(base, nthText, dowCode, interval = 1) {
  const nthValue = ordFromText(nthText);
  if (nthValue == null) return null;
  const step = Number.isFinite(interval) && interval > 0 ? Math.trunc(interval) : 1;
  let year = base.getFullYear();
  let monthIndex = base.getMonth();
  let candidate = computeNthDowForMonth(year, monthIndex, nthValue, dowCode);
  if (candidate && candidate > base && step === 1) {
    return candidate;
  }
  for (let attempts = 0; attempts < 48; attempts++) {
    ({ year, month: monthIndex } = advanceMonth(year, monthIndex, step));
    candidate = computeNthDowForMonth(year, monthIndex, nthValue, dowCode);
    if (candidate) return candidate;
  }
  return null;
}

export function nextMonthLastDay(base) {
  const y = base.getFullYear();
  const m = base.getMonth();
  const thisMonthEom = new Date(y, m + 1, 0, 12, 0, 0, 0);
  const isAtOrAfterEom = base.getDate() >= thisMonthEom.getDate();
  const targetMonth = isAtOrAfterEom ? m + 2 : m + 1;
  return new Date(y, targetMonth, 0, 12, 0, 0, 0);
}

export function resolveYearlyMonth(rule, meta) {
  if (Number.isInteger(rule?.month) && rule.month >= 1 && rule.month <= 12) {
    return Math.trunc(rule.month);
  }
  const due = meta?.due instanceof Date && !Number.isNaN(meta.due.getTime()) ? meta.due : null;
  if (due) return due.getMonth() + 1;
  return todayLocal().getMonth() + 1;
}

export function resolveYearlyDay(rule, meta) {
  if (Number.isInteger(rule?.day) && rule.day >= 1 && rule.day <= 31) {
    return Math.trunc(rule.day);
  }
  const due = meta?.due instanceof Date && !Number.isNaN(meta.due.getTime()) ? meta.due : null;
  if (due) return due.getDate();
  return todayLocal().getDate();
}

export function nextYearlyOnDay(base, rule, meta) {
  const month = resolveYearlyMonth(rule, meta);
  const day = resolveYearlyDay(rule, meta);
  if (!month || !day) return null;
  const monthIndex = month - 1;
  let year = base.getFullYear();
  const candidate = new Date(year, monthIndex, clampDayInMonth(year, monthIndex, day), 12, 0, 0, 0);
  if (candidate > base) return candidate;
  year += 1;
  return new Date(year, monthIndex, clampDayInMonth(year, monthIndex, day), 12, 0, 0, 0);
}

export function nextYearlyNthDow(base, rule, meta) {
  const month = resolveYearlyMonth(rule, meta);
  const nthValue = ordFromText(rule?.nth);
  const dow = rule?.dow;
  if (!month || nthValue == null || !dow) return null;
  const monthIndex = month - 1;
  let year = base.getFullYear();
  let candidate = computeNthDowForMonth(year, monthIndex, nthValue, dow);
  if (candidate && candidate > base) return candidate;
  for (let i = 0; i < 5; i++) {
    year += 1;
    candidate = computeNthDowForMonth(year, monthIndex, nthValue, dow);
    if (candidate) return candidate;
  }
  return null;
}

export function nextMonthlyMultiNth(base, rule) {
  const dow = rule?.dow;
  const nths = Array.isArray(rule?.nths) ? rule.nths : [];
  if (!dow || !nths.length) return null;
  const ordinalValues = nths
    .map((token) => ordFromText(token))
    .filter((value) => value != null)
    .sort((a, b) => a - b);
  if (!ordinalValues.length) return null;
  let year = base.getFullYear();
  let monthIndex = base.getMonth();
  for (let attempts = 0; attempts < 48; attempts++) {
    const monthCandidates = ordinalValues
      .map((nth) => computeNthDowForMonth(year, monthIndex, nth, dow))
      .filter(Boolean)
      .sort((a, b) => a - b);
    for (const candidate of monthCandidates) {
      if (attempts > 0 || candidate > base) {
        return candidate;
      }
    }
    ({ year, month: monthIndex } = advanceMonth(year, monthIndex, 1));
  }
  return null;
}

export function nextMonthlyNthFromEnd(base, rule) {
  const nth = Number.isInteger(rule?.nth) ? rule.nth : Number.parseInt(rule?.nth, 10);
  const dow = rule?.dow;
  if (!nth || !dow) return null;
  let year = base.getFullYear();
  let monthIndex = base.getMonth();
  for (let attempts = 0; attempts < 48; attempts++) {
    const candidate = nthDowFromEnd(year, monthIndex, dow, nth);
    if (candidate && (attempts > 0 || candidate > base)) return candidate;
    ({ year, month: monthIndex } = advanceMonth(year, monthIndex, 1));
  }
  return null;
}

export function nextMonthlyWeekday(base, rule) {
  const nth = (rule?.nth || "").toString().toLowerCase();
  if (nth !== "first" && nth !== "last") return null;
  let year = base.getFullYear();
  let monthIndex = base.getMonth();
  for (let attempts = 0; attempts < 48; attempts++) {
    const candidate =
      nth === "first" ? firstWeekdayOfMonth(year, monthIndex) : lastWeekdayOfMonth(year, monthIndex);
    if (candidate && (attempts > 0 || candidate > base)) return candidate;
    ({ year, month: monthIndex } = advanceMonth(year, monthIndex, 1));
  }
  return null;
}

export function firstWeekdayOfMonth(year, monthIndex) {
  let d = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    if (!isWeekend(d)) return d;
    d = addDaysLocal(d, 1);
  }
  return null;
}

export function lastWeekdayOfMonth(year, monthIndex) {
  let d = new Date(year, monthIndex + 1, 0, 12, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    if (!isWeekend(d)) return d;
    d = addDaysLocal(d, -1);
  }
  return null;
}

export function nextMonthlyMultiDay(base, rule) {
  const list = Array.isArray(rule.days) ? rule.days : [];
  if (!list.length) return null;
  const normalized = list
    .map((token) => (typeof token === "string" ? token.toUpperCase() : token))
    .map((token) => (token === "LAST" ? "LAST" : Number(token)))
    .filter((token) => token === "LAST" || (Number.isInteger(token) && token >= 1 && token <= 31))
    .sort((a, b) => {
      if (a === "LAST") return 1;
      if (b === "LAST") return -1;
      return a - b;
    });
  if (!normalized.length) return null;
  let year = base.getFullYear();
  let monthIndex = base.getMonth();
  // Exclusive threshold: on the starting month, only days after the base day
  // count; once we roll into a later month every listed day is eligible (0).
  let afterDay = base.getDate();
  for (let attempts = 0; attempts < 48; attempts++) {
    for (const token of normalized) {
      if (token === "LAST") {
        const candidate = new Date(year, monthIndex + 1, 0, 12, 0, 0, 0);
        if (candidate.getDate() > afterDay) return candidate;
      } else if (token > afterDay) {
        return new Date(year, monthIndex, token, 12, 0, 0, 0);
      }
    }
    ({ year, month: monthIndex } = advanceMonth(year, monthIndex, 1));
    afterDay = 0;
  }
  return null;
}

export function nextMonthlyMixedDay(base, rule) {
  const days = Array.isArray(rule.days) ? rule.days : [];
  const includeLast = !!rule.last;
  const combined = [...days];
  if (includeLast) combined.push("LAST");
  return nextMonthlyMultiDay(base, { days: combined });
}

export function nthDowOfMonth(first, dowCode, nth) {
  const target = DOW_IDX.indexOf(dowCode);
  if (target < 0) return null;
  let d = new Date(first.getTime());
  while (d.getDay() !== target) d = addDaysLocal(d, 1);
  d = addDaysLocal(d, 7 * (nth - 1));
  if (d.getMonth() !== first.getMonth()) return null;
  return d;
}

export function nthDowFromEnd(year, monthIndex, dowCode, nthFromEnd) {
  const target = DOW_IDX.indexOf(dowCode);
  if (target < 0) return null;
  let x = new Date(year, monthIndex + 1, 0, 12, 0, 0, 0);
  let count = 0;
  while (x.getMonth() === monthIndex) {
    if (x.getDay() === target) {
      count += 1;
      if (count === nthFromEnd) return new Date(x.getTime());
    }
    x = addDaysLocal(x, -1);
  }
  return null;
}

export function computeNthDowForMonth(year, monthIndex, nthValue, dowCode) {
  if (nthValue == null) return null;
  if (nthValue > 0) {
    return nthDowOfMonth(new Date(year, monthIndex, 1, 12, 0, 0, 0), dowCode, nthValue);
  }
  return nthDowFromEnd(year, monthIndex, dowCode, Math.abs(nthValue));
}

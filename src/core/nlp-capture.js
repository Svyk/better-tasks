// Local-first NLP quick-capture parser for Better Tasks.
// Extracted verbatim from src/index.js so it can be unit-tested in Node.
// Pure: the settings snapshot (weekStartCode, dateFormat, …) is passed in by
// the caller instead of being read from extensionAPI here.

import { parseDateFromText, parseRuleText } from "./recurrence.js";

export const LOCAL_DATE_KEYWORDS = new Set([
  "today", "tomorrow", "tmr", "tmrw", "tonight",
  "next", "this", "early", "mid", "late", "in", "end",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thurs", "fri", "sat", "sun",
]);
export const LOCAL_REPEAT_STARTERS = /\b(every\s+.+|daily|weekly|monthly|yearly|annually|biweekly|fortnightly|quarterly|weekdays|weekends)\b/i;

export function validateParsedTask(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: new Error("Invalid JSON shape") };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { ok: false, error: new Error("Missing title") };
  const task = { title };
  if (typeof raw.repeatRule === "string" && raw.repeatRule.trim()) task.repeatRule = raw.repeatRule.trim();
  if (typeof raw.dueDateText === "string" && raw.dueDateText.trim()) task.dueDateText = raw.dueDateText.trim();
  if (typeof raw.startDateText === "string" && raw.startDateText.trim()) task.startDateText = raw.startDateText.trim();
  if (typeof raw.deferDateText === "string" && raw.deferDateText.trim()) task.deferDateText = raw.deferDateText.trim();
  if (typeof raw.project === "string" && raw.project.trim()) task.project = raw.project.trim();
  if (typeof raw.context === "string" && raw.context.trim()) task.context = raw.context.trim();
  const allowedRatings = new Set(["low", "medium", "high"]);
  if (typeof raw.priority === "string" && allowedRatings.has(raw.priority)) task.priority = raw.priority;
  if (raw.priority === null) task.priority = null;
  if (typeof raw.energy === "string" && allowedRatings.has(raw.energy)) task.energy = raw.energy;
  if (raw.energy === null) task.energy = null;
  return { ok: true, task };
}

export function parseTaskLocally(rawText, set) {
  if (!rawText || typeof rawText !== "string") return { ok: false };
  let working = rawText.trim();
  const result = {};

  // Phase A: explicit markers
  // due:/start:/defer: prefixes — try next 1-4 words, take longest parseable match
  for (const prefix of ["due", "start", "defer"]) {
    const re = new RegExp(`\\b${prefix}:\\s*`, "i");
    const m = working.match(re);
    if (m) {
      const afterPrefix = working.slice(m.index + m[0].length);
      const words = afterPrefix.split(/\s+/).filter(Boolean);
      let bestLen = 0;
      let bestParsed = null;
      for (let len = Math.min(4, words.length); len >= 1; len--) {
        const candidate = words.slice(0, len).join(" ");
        // Stop if candidate starts with a known marker
        if (/^[!~@]|^p:/i.test(candidate)) break;
        const parsed = parseDateFromText(candidate, set);
        if (parsed.date) { bestLen = len; bestParsed = parsed; break; }
      }
      if (bestParsed) {
        const key = prefix === "due" ? "dueDateText" : prefix === "start" ? "startDateText" : "deferDateText";
        result[key] = bestParsed.text || words.slice(0, bestLen).join(" ");
        const fullMatch = m[0] + words.slice(0, bestLen).join(" ");
        working = working.replace(fullMatch, " ");
      }
    }
  }

  // !priority (no \b before ! since it's not a word character)
  const prioMatch = working.match(/(?:^|\s)!(high|medium|low)\b/i);
  if (prioMatch) {
    result.priority = prioMatch[1].toLowerCase();
    working = working.replace(prioMatch[0], " ");
  }

  // ~energy
  const energyMatch = working.match(/(?:^|\s)~(high|medium|low)\b/i);
  if (energyMatch) {
    result.energy = energyMatch[1].toLowerCase();
    working = working.replace(energyMatch[0], " ");
  }

  // p:project
  const projMatch = working.match(/\bp:("[^"]+"|[\S]+)/i);
  if (projMatch) {
    result.project = projMatch[1].replace(/^"|"$/g, "").trim();
    working = working.replace(projMatch[0], " ");
  }

  // @context (no \b before @ since it's not a word character)
  const ctxMatch = working.match(/(?:^|\s)@([\S]+)/);
  if (ctxMatch) {
    result.context = ctxMatch[1].trim();
    working = working.replace(ctxMatch[0], " ");
  }

  // Phase B: repeat rules
  const repeatMatch = working.match(LOCAL_REPEAT_STARTERS);
  if (repeatMatch) {
    // Try from the match start to end of remaining text, progressively shorter
    const fromRepeat = working.slice(repeatMatch.index).trim();
    const words = fromRepeat.split(/\s+/);
    let found = false;
    for (let len = words.length; len >= 1; len--) {
      const candidate = words.slice(0, len).join(" ");
      const rule = parseRuleText(candidate, set);
      if (rule) {
        result.repeatRule = candidate;
        working = working.slice(0, repeatMatch.index) + " " + words.slice(len).join(" ");
        found = true;
        break;
      }
    }
    if (!found) {
      // Try single keyword forms
      const singleWord = repeatMatch[1].split(/\s+/)[0].toLowerCase();
      if (parseRuleText(singleWord, set)) {
        result.repeatRule = singleWord;
        working = working.replace(new RegExp(`\\b${singleWord}\\b`, "i"), " ");
      }
    }
  }

  // Phase C: implicit trailing date
  if (!result.dueDateText) {
    working = working.replace(/\s+/g, " ").trim();
    const words = working.split(" ");
    for (let len = Math.min(4, words.length - 1); len >= 1; len--) {
      const candidate = words.slice(-len).join(" ");
      const firstWord = words[words.length - len].toLowerCase();
      if (!LOCAL_DATE_KEYWORDS.has(firstWord)) continue;
      const parsed = parseDateFromText(candidate, set);
      if (parsed.date) {
        result.dueDateText = parsed.text || candidate;
        working = words.slice(0, -len).join(" ");
        break;
      }
    }
  }

  // Phase D: title cleanup
  const title = working.replace(/\s+/g, " ").replace(/^[\s\-–—,]+|[\s\-–—,]+$/g, "").trim();
  result.title = title;

  return validateParsedTask(result);
}

export function stripSchedulingFromTitle(title, parsed) {
  const hasRepeat = typeof parsed?.repeatRule === "string" && parsed.repeatRule.trim();
  const hasDate =
    typeof parsed?.dueDateText === "string" && parsed.dueDateText.trim() ||
    typeof parsed?.startDateText === "string" && parsed.startDateText.trim() ||
    typeof parsed?.deferDateText === "string" && parsed.deferDateText.trim();
  let t = (title || "").trim();
  if (!t) return t;
  if (hasRepeat) {
    t = t.replace(/,\s*every\b.+$/i, "").trim();
    t = t.replace(/\bevery\s+.+$/i, "").trim();
    // Only drop bare cadence words when they are effectively trailing schedule hints (optionally with at/on ...)
    t = t.replace(/\b(daily|weekly|monthly|yearly|annually|weekdays|weekends)\b\s*(?:(?:at|on)\b.*)?$/i, "").trim();
  }
  if (hasDate) {
    t = t.replace(/\s*(on|by|due|for)\s+(tomorrow|today|next\s+[a-z]+|this\s+[a-z]+)$/i, "").trim();
    t = t.replace(/\s*(on\s+)?\[\[[^\]]+\]\]\s*$/i, "").trim();
    t = t.replace(/\s*(tomorrow|today|next\s+[a-z]+)$/i, "").trim();
  }
  return t || (title || "").trim();
}

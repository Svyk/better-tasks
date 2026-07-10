// Pure Smart Suggestions engine for Better Tasks.
//
// Advisory-only nudges derived from heuristics over the dashboard task set,
// per-task snooze counts (from the activity log) and recurring-series history.
// Nothing here writes anything: each suggestion carries an `action` descriptor
// that the caller executes only on an explicit user Accept.
//
// Pure: no Roam, no DOM, no settings access. The caller (src/index.js) injects
// everything impure:
//
//   input = {
//     tasks:        [{ uid, title, isCompleted, isRecurring, isBlocked,
//                      dueAt: Date|null, deferUntil: Date|null, startAt: Date|null,
//                      editedAt: number|null,            // raw epoch ms (:edit/time)
//                      metadata: { gtd, priority } }],
//     snoozeCounts: Map<uid, number> | null,             // null = activity log disabled
//     series:       [{ seriesId, title,
//                      openMember: { uid, dueAt: Date|null } | null,
//                      completions: [{ completedAt: Date, dueAt: Date|null }],
//                      stats: { onTimeRate,               // percentage 0-100
//                               totalCompleted, totalWithDue } }],
//   }
//   options = { now: Date, thresholds: {...SUGGESTION_DEFAULTS overrides},
//               enabledRules: { [ruleId]: boolean } }     // absent = enabled
//
// Suggestions are structured data (ruleId + params), never English strings —
// the UI renders them through i18n, and weekday params are 0-6 indices that
// the UI localises with Intl.
//
// Suggestion ids are stable across recomputes so persisted dismissals keep
// suppressing the same nudge: `ruleId:subject[:evidenceKey]`, where subject is
// a task uid or series id (both [A-Za-z0-9_-], so ":" splits unambiguously).
// dow-pattern additionally keys on the target weekday — if the dominant day
// shifts, a dismissal of the old target must not suppress the new one.
// load-balance is deliberately keyed on the task alone, not the target week,
// or a dismissal would reset every Monday.

import { addDays, subtractDays, startOfDay } from "./filters.js";

export const SUGGESTION_DEFAULTS = {
  snoozeThreshold: 5, // rule 1: snoozes needed to suggest Someday (user-configurable)
  dowMinCompletions: 5, // rule 2: minimum completion sample per series
  dowMinConcentration: 0.6, // rule 2: modal weekday must hold >= 60% of completions
  loadHorizonDays: 7, // rule 3: window is tomorrow .. now+7d
  loadMinTotal: 6, // rule 3: minimum tasks due inside the window
  loadMinPeak: 4, // rule 3: heaviest day must have at least this many
  stalledDays: 14, // rule 4: injected from the bt-stalled-days setting
  stalledFarFutureDays: 60, // rule 4: a due date beyond this counts as "far future"
  adherenceMinSample: 5, // rule 5: series needs >= 5 dated completions
  adherenceMaxOnTimeRate: 50, // rule 5: on-time percentage at or below this triggers
  cooldownDays: 30, // dismissed/accepted suggestions stay suppressed this long
  maxPerRule: 5,
  maxTotal: 15,
  maxDismissalEntries: 300,
};

export const SUGGESTION_RULE_IDS = [
  "snooze-someday",
  "dow-pattern",
  "load-balance",
  "stalled-someday",
  "recurring-adherence",
];

/** Local-calendar ISO date (YYYY-MM-DD). toISOString would shift across UTC. */
export function toISODateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function gtdIsSomeday(task) {
  return ((task.metadata && task.metadata.gtd) || "").toLowerCase() === "someday";
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Open one-off tasks are the only ones the Someday rules may nominate. */
function eligibleForSomeday(task) {
  return !!task && !task.isCompleted && !task.isRecurring && !task.isBlocked && !gtdIsSomeday(task);
}

/**
 * Rule 1 — snoozed N+ times, suggest Someday/Maybe.
 * `snoozeCount` comes from the activity log; the caller passes undefined when
 * the count is unknown, which never triggers.
 */
export function ruleSnoozeSomeday(task, snoozeCount, t) {
  if (!eligibleForSomeday(task)) return null;
  if (typeof snoozeCount !== "number" || snoozeCount < t.snoozeThreshold) return null;
  return {
    id: `snooze-someday:${task.uid}`,
    ruleId: "snooze-someday",
    taskUid: task.uid,
    seriesId: null,
    title: task.title,
    params: { count: snoozeCount },
    action: { type: "set-gtd", payload: { gtd: "someday" } },
    score: 90 + Math.min(snoozeCount - t.snoozeThreshold, 9),
  };
}

/**
 * Rule 2 — a recurring series is usually completed on one weekday but the open
 * occurrence is due on a different one; suggest moving the due date to the
 * modal weekday. Target is that weekday within the due date's Sun-Sat week,
 * rolled forward a week at a time until it is not in the past.
 */
export function ruleDayOfWeekPattern(series, opts) {
  if (!series || !series.openMember || !isValidDate(series.openMember.dueAt)) return null;
  const completions = Array.isArray(series.completions) ? series.completions : [];
  const dated = completions.filter((c) => c && isValidDate(c.completedAt));
  if (dated.length < opts.dowMinCompletions) return null;

  const counts = new Array(7).fill(0);
  for (const c of dated) counts[c.completedAt.getDay()] += 1;
  let modal = 0;
  for (let i = 1; i < 7; i += 1) if (counts[i] > counts[modal]) modal = i;
  const concentration = counts[modal] / dated.length;
  if (concentration < opts.dowMinConcentration) return null;

  const due = series.openMember.dueAt;
  if (due.getDay() === modal) return null;

  const startOfToday = startOfDay(opts.now);
  let target = addDays(due, modal - due.getDay());
  while (target < startOfToday) target = addDays(target, 7);
  const targetISO = toISODateLocal(target);

  return {
    id: `dow-pattern:${series.seriesId}:${modal}`,
    ruleId: "dow-pattern",
    taskUid: series.openMember.uid,
    seriesId: series.seriesId,
    title: series.title,
    params: {
      weekday: modal,
      count: dated.length,
      percent: Math.round(concentration * 100),
      targetISO,
    },
    action: { type: "set-due", payload: { dueISO: targetISO } },
    score: 70 + Math.min(dated.length, 9),
  };
}

/** Missing priority ranks between low and medium: unknown is safer to move than high. */
const MOVE_SAFETY_ORDER = { low: 0, "": 1, medium: 2, high: 3 };

/**
 * Rule 3 — one day in the coming week is overloaded while another is empty;
 * suggest moving one flexible task from the peak day to the empty day.
 * All open tasks count toward the load, but only unblocked one-offs whose
 * defer/start does not forbid the target day are candidates to move.
 * Emits at most one suggestion, fully deterministic for a given input.
 */
export function ruleLoadBalance(tasks, opts) {
  const startOfToday = startOfDay(opts.now);
  const dayISOs = [];
  for (let offset = 1; offset <= opts.loadHorizonDays; offset += 1) {
    dayISOs.push(toISODateLocal(addDays(startOfToday, offset)));
  }
  const daySet = new Set(dayISOs);

  const byDay = new Map(dayISOs.map((iso) => [iso, []]));
  let total = 0;
  for (const task of tasks) {
    if (!task || task.isCompleted || !isValidDate(task.dueAt)) continue;
    const iso = toISODateLocal(task.dueAt);
    if (!daySet.has(iso)) continue;
    byDay.get(iso).push(task);
    total += 1;
  }
  if (total < opts.loadMinTotal) return [];

  let peakISO = null;
  for (const iso of dayISOs) {
    if (peakISO === null || byDay.get(iso).length > byDay.get(peakISO).length) peakISO = iso;
  }
  if (byDay.get(peakISO).length < opts.loadMinPeak) return [];

  // Target: the empty day nearest the peak day, so the move disturbs the
  // task's schedule as little as possible. On a tie, prefer the later day —
  // pulling a deadline earlier shortens its lead time for no benefit.
  const peakIdx = dayISOs.indexOf(peakISO);
  let emptyIdx = -1;
  let bestDist = Infinity;
  for (let idx = 0; idx < dayISOs.length; idx += 1) {
    if (byDay.get(dayISOs[idx]).length !== 0) continue;
    const dist = Math.abs(idx - peakIdx);
    if (dist < bestDist || (dist === bestDist && idx > peakIdx)) {
      bestDist = dist;
      emptyIdx = idx;
    }
  }
  if (emptyIdx === -1) return [];
  const emptyISO = dayISOs[emptyIdx];

  const candidates = byDay
    .get(peakISO)
    .filter((task) => {
      if (task.isRecurring || task.isBlocked) return false;
      // Defer/start after the target day would make the move self-defeating.
      if (isValidDate(task.deferUntil) && toISODateLocal(task.deferUntil) > emptyISO) return false;
      if (isValidDate(task.startAt) && toISODateLocal(task.startAt) > emptyISO) return false;
      return true;
    })
    .sort((a, b) => {
      const pa = MOVE_SAFETY_ORDER[((a.metadata && a.metadata.priority) || "").toLowerCase()] ?? 1;
      const pb = MOVE_SAFETY_ORDER[((b.metadata && b.metadata.priority) || "").toLowerCase()] ?? 1;
      if (pa !== pb) return pa - pb;
      return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
    });
  if (!candidates.length) return [];

  const pick = candidates[0];
  const fromDate = pick.dueAt;
  const toDate = addDays(startOfToday, emptyIdx + 1);
  return [
    {
      id: `load-balance:${pick.uid}`,
      ruleId: "load-balance",
      taskUid: pick.uid,
      seriesId: null,
      title: pick.title,
      params: {
        fromWeekday: fromDate.getDay(),
        toWeekday: toDate.getDay(),
        fromCount: byDay.get(peakISO).length,
        fromISO: peakISO,
        toISO: emptyISO,
        targetISO: emptyISO,
      },
      action: { type: "set-due", payload: { dueISO: emptyISO } },
      score: 50,
    },
  ];
}

/**
 * Rule 4 — open one-off with no recent activity and no near-term due date;
 * suggest Someday/Maybe. Stalledness uses the exact predicate of the dashboard
 * Stalled filter (filters.js): missing :edit/time counts as stalled, and the
 * threshold is calendar-day arithmetic, not ms maths.
 */
export function ruleStalledSomeday(task, opts) {
  if (!eligibleForSomeday(task)) return null;
  const startOfToday = startOfDay(opts.now);
  const stalledThreshold = subtractDays(startOfToday, opts.stalledDays).getTime();
  const hasEditTime = typeof task.editedAt === "number" && task.editedAt > 0;
  if (hasEditTime && task.editedAt >= stalledThreshold) return null;
  if (isValidDate(task.dueAt)) {
    const farFuture = addDays(startOfToday, opts.stalledFarFutureDays);
    if (task.dueAt <= farFuture) return null; // scheduled soon enough — not neglected
  }
  // Display-only day count; the trigger above already used DST-safe arithmetic.
  const days = hasEditTime
    ? Math.max(opts.stalledDays, Math.floor((startOfToday.getTime() - task.editedAt) / 86400000))
    : opts.stalledDays;
  return {
    id: `stalled-someday:${task.uid}`,
    ruleId: "stalled-someday",
    taskUid: task.uid,
    seriesId: null,
    title: task.title,
    params: { days },
    action: { type: "set-gtd", payload: { gtd: "someday" } },
    score: 60 + Math.min(Math.floor((days - opts.stalledDays) / 7), 9),
  };
}

/**
 * Rule 5 — a recurring series is chronically late; suggest reviewing the
 * repeat rule. Accept opens the existing interactive repeat editor on the open
 * member — nothing is changed automatically.
 */
export function ruleRecurringAdherence(series, t) {
  if (!series || !series.openMember || !series.openMember.uid) return null;
  const stats = series.stats || {};
  if (!(typeof stats.totalWithDue === "number" && stats.totalWithDue >= t.adherenceMinSample)) return null;
  if (!(typeof stats.onTimeRate === "number" && stats.onTimeRate <= t.adherenceMaxOnTimeRate)) return null;
  return {
    id: `recurring-adherence:${series.seriesId}`,
    ruleId: "recurring-adherence",
    taskUid: series.openMember.uid,
    seriesId: series.seriesId,
    title: series.title,
    params: {
      rate: Math.round(stats.onTimeRate),
      // Same population the rate is computed over: completions WITH a due
      // date. totalCompleted would overcount when undated completions exist.
      count: stats.totalWithDue,
    },
    action: { type: "edit-repeat", payload: {} },
    score: 80,
  };
}

/**
 * Run every enabled rule, dedupe, order deterministically, cap.
 *
 * Cross-rule dedupe: snooze-someday and stalled-someday can both nominate the
 * same task; the snooze suggestion carries the stronger evidence and wins.
 */
export function computeSuggestions(input, options = {}) {
  const t = { ...SUGGESTION_DEFAULTS, ...(options.thresholds || {}) };
  const now = options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
  const enabledRules = options.enabledRules || {};
  const isOn = (ruleId) => enabledRules[ruleId] !== false;
  const tasks = Array.isArray(input && input.tasks) ? input.tasks : [];
  const series = Array.isArray(input && input.series) ? input.series : [];
  const snoozeCounts = input && input.snoozeCounts instanceof Map ? input.snoozeCounts : null;
  const opts = { ...t, now };

  const found = [];
  if (isOn("snooze-someday") && snoozeCounts) {
    for (const task of tasks) {
      const s = ruleSnoozeSomeday(task, snoozeCounts.get(task.uid), t);
      if (s) found.push(s);
    }
  }
  if (isOn("dow-pattern")) {
    for (const sr of series) {
      const s = ruleDayOfWeekPattern(sr, opts);
      if (s) found.push(s);
    }
  }
  if (isOn("load-balance")) found.push(...ruleLoadBalance(tasks, opts));
  if (isOn("stalled-someday")) {
    for (const task of tasks) {
      const s = ruleStalledSomeday(task, opts);
      if (s) found.push(s);
    }
  }
  if (isOn("recurring-adherence")) {
    for (const sr of series) {
      const s = ruleRecurringAdherence(sr, t);
      if (s) found.push(s);
    }
  }

  const snoozeUids = new Set(
    found.filter((s) => s.ruleId === "snooze-someday").map((s) => s.taskUid)
  );
  const deduped = found.filter(
    (s) => !(s.ruleId === "stalled-someday" && snoozeUids.has(s.taskUid))
  );

  deduped.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const perRule = new Map();
  const capped = [];
  for (const s of deduped) {
    const n = perRule.get(s.ruleId) || 0;
    if (n >= t.maxPerRule) continue;
    perRule.set(s.ruleId, n + 1);
    capped.push(s);
    if (capped.length >= t.maxTotal) break;
  }
  return capped;
}

/**
 * Drop suggestions suppressed by a dismissal entry still inside its cooldown.
 * Both kinds suppress: `dismissed` (user said no) and `accepted` (already
 * acted on — some accepts, like opening the repeat editor, don't change the
 * evidence, and the nudge would otherwise reappear instantly).
 * An entry exactly `cooldownDays` old no longer suppresses.
 */
export function filterDismissed(suggestions, entries, options = {}) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (!entries || typeof entries !== "object") return list.slice();
  const cooldownDays = Number.isFinite(options.cooldownDays)
    ? options.cooldownDays
    : SUGGESTION_DEFAULTS.cooldownDays;
  const now = options.now instanceof Date ? options.now : new Date();
  const cutoff = subtractDays(now, cooldownDays).getTime();
  return list.filter((s) => {
    const entry = entries[s.id];
    if (!entry || typeof entry.ts !== "number") return true;
    return entry.ts <= cutoff;
  });
}

/** `"ruleId:subject[:evidence]"` → subject (task uid or series id), or null. */
export function suggestionSubject(id) {
  if (typeof id !== "string") return null;
  const parts = id.split(":");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/**
 * Keep the dismissal store bounded (Section A: no unbounded structures).
 * Drops entries that are inert (older than the cooldown — they no longer
 * suppress anything), entries whose subject no longer exists, and the oldest
 * entries beyond `maxEntries`. Returns `{ entries, changed }`; the caller
 * persists only when `changed` is true.
 */
export function pruneDismissals(entries, options = {}) {
  const src = entries && typeof entries === "object" ? entries : {};
  const cooldownDays = Number.isFinite(options.cooldownDays)
    ? options.cooldownDays
    : SUGGESTION_DEFAULTS.cooldownDays;
  const maxEntries = Number.isFinite(options.maxEntries)
    ? options.maxEntries
    : SUGGESTION_DEFAULTS.maxDismissalEntries;
  const now = options.now instanceof Date ? options.now : new Date();
  const existingSubjects =
    options.existingSubjects instanceof Set ? options.existingSubjects : null;
  const cutoff = subtractDays(now, cooldownDays).getTime();

  const kept = Object.entries(src).filter(([id, entry]) => {
    if (!entry || typeof entry.ts !== "number") return false;
    if (entry.ts <= cutoff) return false;
    if (existingSubjects && !existingSubjects.has(suggestionSubject(id))) return false;
    return true;
  });
  kept.sort((a, b) => b[1].ts - a[1].ts);
  const sliced = kept.slice(0, maxEntries);
  return {
    entries: Object.fromEntries(sliced),
    changed: sliced.length !== Object.keys(src).length,
  };
}

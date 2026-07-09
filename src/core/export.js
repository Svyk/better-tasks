// Pure export serialisers for Better Tasks (CSV / JSON / ICS).
// Extracted from src/index.js so they can be unit-tested in Node. No Roam,
// DOM or clock dependencies: the caller supplies the task array, and the
// download/toast side effects stay in index.js.
//
// Input shape is whatever `buildToolTaskSummary` produces:
//   { uid, title, status, due, start, defer, completed, page_title,
//     is_blocked, is_subtask, parent_task_uid, subtask_uids,
//     attributes: { repeat, project, waitingFor, context[], priority,
//                   energy, gtd, depends[], parent } }
// Dates are ISO (`YYYY-MM-DD`) — buildExportData forces dateFormat: "ISO".

// ========================= CSV =========================

export const CSV_HEADERS = [
  "uid", "title", "status", "due", "start", "defer", "completed",
  "repeat", "project", "waiting_for", "context", "priority", "energy",
  "gtd", "depends", "parent", "page_title", "is_blocked", "is_subtask",
  "parent_task_uid", "subtask_uids"
];

export function escapeCSV(value) {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function taskToCSVRow(task) {
  const a = task.attributes || {};
  return [
    task.uid,
    task.title,
    task.status,
    task.due || "",
    task.start || "",
    task.defer || "",
    task.completed || "",
    a.repeat || "",
    a.project || "",
    a.waitingFor || "",
    (a.context || []).join("; "),
    a.priority || "",
    a.energy || "",
    a.gtd || "",
    (a.depends || []).join("; "),
    a.parent || "",
    task.page_title || "",
    task.is_blocked ? "true" : "false",
    task.is_subtask ? "true" : "false",
    task.parent_task_uid || "",
    (task.subtask_uids || []).join("; "),
  ];
}

export function buildCSVContent(tasks) {
  const rows = [CSV_HEADERS.join(",")];
  for (const task of tasks) {
    rows.push(taskToCSVRow(task).map(escapeCSV).join(","));
  }
  return { content: rows.join("\n"), count: tasks.length };
}

// ========================= JSON =========================

export function buildJSONContent(tasks) {
  return { content: JSON.stringify(tasks, null, 2), count: tasks.length };
}

// ========================= ICS (RFC 5545) =========================

// RFC 5545 §3.3.11 — inside a TEXT value, BACKSLASH, SEMICOLON, COMMA and
// newlines are not TSAFE-CHARs and must be escaped. Backslash must go first.
export function escapeICSText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// RFC 5545 §3.1 — content lines are limited to 75 octets (excluding CRLF) and
// are folded with CRLF + one leading space. Fold on octet boundaries without
// splitting a multi-byte UTF-8 sequence, so we measure encoded length per
// code point rather than using String#length.
const ICS_LINE_OCTETS = 75;

export function foldICSLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= ICS_LINE_OCTETS) return line;

  const parts = [];
  let current = "";
  let currentOctets = 0;
  for (const char of line) { // iterates by code point, not UTF-16 unit
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > ICS_LINE_OCTETS) {
      parts.push(current);
      current = " "; // continuation prefix counts toward the next line's limit
      currentOctets = 1;
    }
    current += char;
    currentOctets += octets;
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}

export function toICSDate(isoDate) {
  if (!isoDate) return null;
  return isoDate.replace(/-/g, "");
}

// DTSTAMP is REQUIRED in a VEVENT (RFC 5545 §3.6.1) and is a UTC date-time.
export function formatICSTimestamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

// A task only becomes a VEVENT if it carries at least one date.
export function hasExportableDate(task) {
  return !!(task.due || task.start || task.defer);
}

export function buildICSContent(tasks, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const dtstamp = formatICSTimestamp(now);
  const withDates = tasks.filter(hasExportableDate);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BetterTasks//Roam Research//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Better Tasks",
  ];
  for (const task of withDates) {
    const eventDate = task.due || task.defer || task.start;
    if (!eventDate) continue;
    const dtStart = toICSDate(eventDate);
    // All-day event: DTEND = DTSTART + 1 day (exclusive, per iCal spec)
    const nextDay = new Date(`${eventDate}T12:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const dtEnd = `${nextDay.getFullYear()}${String(nextDay.getMonth() + 1).padStart(2, "0")}${String(nextDay.getDate()).padStart(2, "0")}`;
    const status = task.status === "DONE" ? " [DONE]" : "";
    const project = task.attributes?.project ? ` [${task.attributes.project}]` : "";
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${task.uid}@bettertasks.roam`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(`SUMMARY:${escapeICSText(`${task.title || task.text || ""}${status}${project}`)}`);
    if (task.attributes?.project) lines.push(`CATEGORIES:${escapeICSText(task.attributes.project)}`);
    if (task.status === "DONE") lines.push("STATUS:CONFIRMED");
    else lines.push("STATUS:TENTATIVE");
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return {
    content: lines.map(foldICSLine).join("\r\n"),
    count: withDates.length,
    skipped: tasks.length - withDates.length,
  };
}

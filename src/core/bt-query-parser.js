// Pure parser for the `{{bt-query: ...}}` component syntax.
//
// Better Tasks mounts an interactive result list wherever a block contains a
// bt-query invocation. The vocabulary deliberately mirrors the `bt_search`
// Extension Tools API 1:1 — results come from the same engine — so anything
// bt_search can filter, bt-query can filter, and nothing more.
//
// Grammar:
//   {{bt-query}}                                    → all defaults
//   {{bt-query: status="TODO" due="this-week"}}     → key="value" pairs
//   Values: double- or single-quoted (spaces allowed), bare single tokens,
//   or bare [[Page Title]] refs (read to the matching ]]).
//
// Unknown keys and malformed values are ERRORS, not silently ignored — the
// component renders them inline so users learn the vocabulary. Error entries
// are structured ({code, key?, value?}) so the UI can localise messages.

export const KNOWN_KEYS = [
  "status",
  "project",
  "due",
  "completed",
  "blocked",
  "assignee",
  "query",
  "limit",
  "sort",
];

const DUE_NAMED = ["overdue", "today", "upcoming", "this-week", "none"];
const COMPLETED_NAMED = ["today", "this-week", "last-24-hours", "last-7-days"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RANGE_RE = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/;

// First {{bt-query}} / {{bt-query: ...}} occurrence in a block string.
const BT_QUERY_RE = /\{\{\s*bt-query\s*(?::([^}]*))?\}\}/i;

export function isBtQueryBlock(blockText) {
  return typeof blockText === "string" && BT_QUERY_RE.test(blockText);
}

function stripPageRef(value) {
  let v = value.trim();
  if (v.startsWith("#")) v = v.slice(1).trim();
  const m = v.match(/^\[\[(.*)\]\]$/);
  return m ? m[1].trim() : v;
}

/** Tokenise `key="value" key2=bare` into [{key, value}] + syntax errors. */
function tokenize(argsText, errors) {
  const pairs = [];
  let i = 0;
  const len = argsText.length;
  while (i < len) {
    while (i < len && /\s/.test(argsText[i])) i += 1;
    if (i >= len) break;
    const keyMatch = argsText.slice(i).match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (!keyMatch) {
      errors.push({ code: "syntax", value: argsText.slice(i, i + 12) });
      break;
    }
    const key = keyMatch[1];
    i += key.length;
    while (i < len && /\s/.test(argsText[i])) i += 1;
    if (argsText[i] !== "=") {
      errors.push({ code: "syntax", key });
      break;
    }
    i += 1;
    while (i < len && /\s/.test(argsText[i])) i += 1;
    let value = "";
    const quote = argsText[i];
    if (quote === '"' || quote === "'") {
      const end = argsText.indexOf(quote, i + 1);
      if (end === -1) {
        errors.push({ code: "unterminated", key });
        break;
      }
      value = argsText.slice(i + 1, end);
      i = end + 1;
    } else if (argsText.startsWith("[[", i)) {
      // Bare page ref: read to the matching ]] (depth-aware).
      let depth = 0;
      const start = i;
      while (i < len) {
        if (argsText.startsWith("[[", i)) {
          depth += 1;
          i += 2;
          continue;
        }
        if (argsText.startsWith("]]", i)) {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
          continue;
        }
        i += 1;
      }
      if (depth !== 0) {
        errors.push({ code: "unterminated", key });
        break;
      }
      value = argsText.slice(start, i);
    } else {
      const start = i;
      while (i < len && !/\s/.test(argsText[i])) i += 1;
      value = argsText.slice(start, i);
    }
    pairs.push({ key, value });
  }
  return pairs;
}

function validateDateish(value, named) {
  const lower = value.toLowerCase();
  if (named.includes(lower)) return lower;
  if (ISO_RE.test(value) || ISO_RANGE_RE.test(value)) return value;
  return null;
}

/**
 * Parse a block string containing a bt-query invocation.
 *
 * @returns {{
 *   isBtQuery: boolean,
 *   filters: {status?, project?, due?, completed?, blocked?, assignee?, query?},
 *   limit: number|null,
 *   sort: string|null,
 *   errors: {code: string, key?: string, value?: string}[]
 * }}
 */
export function parseBtQuery(blockText) {
  const result = { isBtQuery: false, filters: {}, limit: null, sort: null, errors: [] };
  if (typeof blockText !== "string") return result;
  const match = blockText.match(BT_QUERY_RE);
  if (!match) return result;
  result.isBtQuery = true;
  const argsText = (match[1] || "").trim();
  if (!argsText) return result;

  const pairs = tokenize(argsText, result.errors);
  for (const { key, value } of pairs) {
    const lowerKey = key.toLowerCase();
    if (!KNOWN_KEYS.includes(lowerKey)) {
      result.errors.push({ code: "unknownKey", key });
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      result.errors.push({ code: "badValue", key: lowerKey, value });
      continue;
    }
    switch (lowerKey) {
      case "status": {
        const upper = trimmed.toUpperCase();
        if (upper === "TODO" || upper === "DONE" || upper === "ALL") {
          result.filters.status = upper === "ALL" ? "all" : upper;
        } else {
          result.errors.push({ code: "badValue", key: lowerKey, value: trimmed });
        }
        break;
      }
      case "due": {
        const v = validateDateish(trimmed, DUE_NAMED);
        if (v) result.filters.due = v;
        else result.errors.push({ code: "badValue", key: lowerKey, value: trimmed });
        break;
      }
      case "completed": {
        const v = validateDateish(trimmed, COMPLETED_NAMED);
        if (v) result.filters.completed = v;
        else result.errors.push({ code: "badValue", key: lowerKey, value: trimmed });
        break;
      }
      case "blocked": {
        const lower = trimmed.toLowerCase();
        if (lower === "blocked" || lower === "actionable") result.filters.blocked = lower;
        else result.errors.push({ code: "badValue", key: lowerKey, value: trimmed });
        break;
      }
      case "limit": {
        const num = Number(trimmed);
        if (Number.isInteger(num) && num >= 1) result.limit = num;
        else result.errors.push({ code: "badValue", key: lowerKey, value: trimmed });
        break;
      }
      case "sort": {
        if (trimmed.toLowerCase() === "due") result.sort = "due";
        else result.errors.push({ code: "badValue", key: lowerKey, value: trimmed });
        break;
      }
      case "project":
        result.filters.project = stripPageRef(trimmed);
        break;
      case "assignee":
        result.filters.assignee = trimmed;
        break;
      case "query":
        result.filters.query = trimmed;
        break;
      default:
        break;
    }
  }
  return result;
}

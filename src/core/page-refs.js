// Pure page-ref formatting helpers for Better Tasks.
//
// Phase 10 "page-ref consistency": attribute values that name pages
// (project, waiting-for, context) are written as `[[page refs]]` so native
// Roam `{{query}}` blocks discover Better Tasks through ordinary linked
// references. Every reader was already bracket-tolerant (stripLinkOrTag in
// index.js, the value normalizers in the metadata stores); these helpers
// make the write side symmetrical.

/**
 * Wrap a page title for writing as a Roam page ref.
 *
 * `"X"` → `"[[X]]"`, `"#X"` / `"#[[X]]"` → `"[[X]]"`, already-bracketed
 * values pass through unchanged (idempotent), empty/non-string → `""`.
 * Titles that themselves contain `[[nested]]` refs are only wrapped when
 * the value isn't already a single outer ref.
 */
export function wrapAsPageRef(title) {
  if (typeof title !== "string") return "";
  let v = title.trim();
  if (!v) return "";
  if (v.startsWith("#")) v = v.slice(1).trim();
  if (!v) return "";
  if (/^\[\[(.*)\]\]$/.test(v)) return v;
  return `[[${v}]]`;
}

/**
 * Split a comma-separated list, treating `[[...]]` refs as atomic so page
 * titles containing commas (e.g. `[[July 12th, 2026]]`) survive. Returns
 * trimmed, non-empty raw tokens — callers strip brackets themselves.
 */
export function splitRefAwareList(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const tokens = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "[" && value[i + 1] === "[") {
      depth += 1;
      current += "[[";
      i += 1;
      continue;
    }
    if (ch === "]" && value[i + 1] === "]" && depth > 0) {
      depth -= 1;
      current += "]]";
      i += 1;
      continue;
    }
    if (ch === "," && depth === 0) {
      tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  tokens.push(current);
  return tokens.map((t) => t.trim()).filter(Boolean);
}

/** `["Home", "[[Deep Work]]"]` → `"[[Home]], [[Deep Work]]"`. */
export function formatContextListForWrite(items) {
  if (!Array.isArray(items)) return "";
  return items.map((item) => wrapAsPageRef(item)).filter(Boolean).join(", ");
}

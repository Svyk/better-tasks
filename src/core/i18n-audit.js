// Build-time audit for untranslated i18n values.
//
// `npm run check:i18n` validates that every locale has the same *keys* as
// English. It cannot tell a native translation from an English stub left
// behind by the two-phase workflow (ship parity stubs with the feature, ship
// native translations in a follow-up). This module closes that blind spot by
// diffing values against the base locale.
//
// Pure — no fs, no Roam, no DOM. The caller supplies the locale map and the
// allowlists. Not imported by src/index.js, so it never reaches the bundle.

// Values that are the same in every language: the product name, acronyms, and
// interjections we deliberately leave untranslated.
export const DEFAULT_VALUE_ALLOWLIST = ["Better Tasks", "GTD", "OK"];

/** Flatten a nested locale object into { "a.b.c": value }. */
export function flattenLeaves(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenLeaves(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

/**
 * True when a value carries no translatable content, so being identical to
 * English proves nothing. Covers interpolation-only strings such as
 * "{{field}} → {{to}}", plus numbers, punctuation, symbols and emoji.
 */
export function isUntranslatable(value, valueAllowlist = DEFAULT_VALUE_ALLOWLIST) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (valueAllowlist.includes(trimmed)) return true;
  // Strip {{placeholders}}, then ask whether any letter remains.
  const withoutPlaceholders = trimmed.replace(/\{\{[^}]*\}\}/g, "");
  return !/\p{L}/u.test(withoutPlaceholders);
}

/**
 * Find values that match the base locale and therefore look untranslated.
 *
 * @param {object} i18n            { en: {...}, fr: {...}, ... }
 * @param {object} [options]
 * @param {string} [options.base]           base locale code (default "en")
 * @param {string[]} [options.valueAllowlist]  values identical in all languages
 * @param {string[]} [options.keyAllowlist]    dotted keys exempt in every locale
 * @param {object} [options.localeAllowlist]   { fr: ["some.key"] } — genuine cognates
 * @returns {{locale: string, key: string, value: string}[]} sorted findings
 */
export function findUntranslated(i18n, options = {}) {
  const {
    base = "en",
    valueAllowlist = DEFAULT_VALUE_ALLOWLIST,
    keyAllowlist = [],
    localeAllowlist = {},
  } = options;

  const baseLeaves = flattenLeaves(i18n[base]);
  const exemptKeys = new Set(keyAllowlist);
  const findings = [];

  for (const locale of Object.keys(i18n).sort()) {
    if (locale === base) continue;
    const leaves = flattenLeaves(i18n[locale]);
    const exemptForLocale = new Set(localeAllowlist[locale] || []);
    for (const [key, baseValue] of Object.entries(baseLeaves)) {
      if (!(key in leaves)) continue; // key parity is check-i18n-parity's job
      if (leaves[key] !== baseValue) continue;
      if (exemptKeys.has(key) || exemptForLocale.has(key)) continue;
      if (isUntranslatable(baseValue, valueAllowlist)) continue;
      findings.push({ locale, key, value: baseValue });
    }
  }
  return findings;
}

/** Group findings by locale for reporting. */
export function groupByLocale(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    if (!grouped.has(finding.locale)) grouped.set(finding.locale, []);
    grouped.get(finding.locale).push(finding);
  }
  return grouped;
}

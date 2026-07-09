// scripts/check-i18n-parity.js
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { assertI18nParity } = require("../src/i18nParity.js");

function loadI18n() {
  const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
  const files = fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const i18n = {};
  for (const file of files) {
    const filename = path.join(localesDir, file);
    const src = fs.readFileSync(filename, "utf8");
    const rewritten = src.replace(/^\s*export\s+default\s+locale\s*;?\s*(?:\/\/.*)?$/m, "module.exports = locale;");
    const sandbox = { module: { exports: {} }, exports: {}, console, Date, Intl };
    const script = new vm.Script(rewritten, { filename });
    script.runInNewContext(sandbox, { timeout: 1000 });
    if (!sandbox.module.exports || typeof sandbox.module.exports !== "object") {
      throw new Error(`[i18n] ${file} did not export a locale object`);
    }
    const localeKey = file.replace(/\.js$/, "");
    i18n[localeKey] = sandbox.module.exports;
  }
  return i18n;
}

function loadAllowlist() {
  const file = path.join(__dirname, "i18n-value-allowlist.json");
  if (!fs.existsSync(file)) return { keys: [], locales: {} };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return { keys: parsed.keys || [], locales: parsed.locales || {} };
}

// Key parity cannot distinguish a native translation from an English stub left
// behind by the two-phase translation workflow. This reports values that still
// match English. Advisory by default — stubs are a legitimate transient state.
async function auditValues(i18n, { verbose, strict }) {
  const { findUntranslated, groupByLocale } = await import("../src/core/i18n-audit.js");
  const allowlist = loadAllowlist();
  const findings = findUntranslated(i18n, {
    base: "en",
    keyAllowlist: allowlist.keys,
    localeAllowlist: allowlist.locales,
  });

  if (!findings.length) {
    console.log("[i18n] No untranslated values ✅");
    return 0;
  }

  const locales = groupByLocale(findings);
  if (verbose) {
    console.log(`\n[i18n] ${findings.length} value(s) still match English:\n`);
    for (const [locale, items] of locales) {
      console.log(`  ${locale}`);
      for (const { key, value } of items) console.log(`    ${key} = ${JSON.stringify(value)}`);
    }
    console.log(
      "\n  If a string is legitimately the same in that language (a cognate, an\n" +
      "  acronym, a brand name), add it to scripts/i18n-value-allowlist.json."
    );
  } else {
    console.log(
      `[i18n] ${findings.length} value(s) still match English across ` +
      `${locales.size} locale(s) — run \`npm run check:i18n:values\` for details`
    );
  }
  return strict ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--values");
  const strict = args.includes("--strict");

  const i18n = loadI18n();
  assertI18nParity(i18n, "en");
  console.log("[i18n] Parity check passed ✅");

  const code = await auditValues(i18n, { verbose, strict });
  if (code !== 0) {
    console.error("[i18n] Untranslated values present and --strict was set ❌");
    process.exit(code);
  }
}

main().catch((err) => {
  console.error("[i18n] Parity check failed ❌");
  console.error(err?.message || err);
  process.exit(1);
});

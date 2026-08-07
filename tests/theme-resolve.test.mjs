import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePanelIsDark } from "../src/core/theme-resolve.js";

// Regression: macOS in dark mode, Roam in its default light theme, no theme
// extension toggle mounted. The OS hint used to win and mark the body
// bt-theme-dark, painting the Today panel's pinned near-white text onto the
// white page. The sampled background (white, luminance 1.0) must win instead.
test("OS dark + Roam light background resolves light", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: null,
      explicitDark: false,
      sampledLuminance: 1.0,
      systemPrefersDark: true,
    }),
    false
  );
});

test("dark background resolves dark even when the OS is light", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: null,
      explicitDark: false,
      sampledLuminance: 0.02,
      systemPrefersDark: false,
    }),
    true
  );
});

test("toggle set to light overrides everything", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: "light",
      explicitDark: true,
      sampledLuminance: 0.02,
      systemPrefersDark: true,
    }),
    false
  );
});

test("toggle set to dark overrides everything", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: "dark",
      explicitDark: false,
      sampledLuminance: 1.0,
      systemPrefersDark: false,
    }),
    true
  );
});

test("bp3-dark marker beats a light sample taken mid theme load", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: null,
      explicitDark: true,
      sampledLuminance: 1.0,
      systemPrefersDark: false,
    }),
    true
  );
});

test("toggle in auto mode defers to the sampled background", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: "auto",
      explicitDark: false,
      sampledLuminance: 1.0,
      systemPrefersDark: true,
    }),
    false
  );
  assert.equal(
    resolvePanelIsDark({
      externalMode: "auto",
      explicitDark: false,
      sampledLuminance: 0.02,
      systemPrefersDark: false,
    }),
    true
  );
});

test("no sample available falls back to the OS hint", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: null,
      explicitDark: false,
      sampledLuminance: null,
      systemPrefersDark: true,
    }),
    true
  );
  assert.equal(
    resolvePanelIsDark({
      externalMode: null,
      explicitDark: false,
      sampledLuminance: null,
      systemPrefersDark: false,
    }),
    false
  );
});

test("NaN luminance is treated as no sample", () => {
  assert.equal(
    resolvePanelIsDark({
      externalMode: null,
      explicitDark: false,
      sampledLuminance: NaN,
      systemPrefersDark: true,
    }),
    true
  );
});

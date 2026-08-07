// Pure decision for whether the dashboard / Today panel should render dark.
//
// Precedence:
//   1. A theme extension's own appearance toggle (Roam Studio / Blueprint)
//      set explicitly to light or dark — the user chose that mode.
//   2. Roam's `bp3-dark` class or `data-theme="dark"` marker.
//   3. The measured luminance of Roam's rendered background. This is the
//      ground truth for what the user is looking at, and it must outrank the
//      OS hint: macOS in dark mode with Roam in its default light theme used
//      to fall through to `prefers-color-scheme` and resolve dark, which
//      tagged `body.bt-theme-dark` and painted the Today panel's pinned
//      near-white dark-mode text onto the white page.
//   4. The OS `prefers-color-scheme` hint, only when nothing above is
//      available (e.g. Roam's chrome isn't mounted yet, so there is no
//      background to sample).
export function resolvePanelIsDark({
  externalMode = null,
  explicitDark = false,
  sampledLuminance = null,
  systemPrefersDark = false,
} = {}) {
  if (externalMode === "dark") return true;
  if (externalMode === "light") return false;
  if (explicitDark) return true;
  if (typeof sampledLuminance === "number" && !Number.isNaN(sampledLuminance)) {
    return sampledLuminance < 0.5;
  }
  return !!systemPrefersDark;
}

import assert from "node:assert/strict";
import test from "node:test";

import { scheduleDashboardWarmup } from "../src/core/dashboard-warmup.js";

test("dashboard warm-up uses an idle slice and loads once", async () => {
  let idleCallback = null;
  let calls = 0;
  const windowLike = {
    requestIdleCallback(callback, options) {
      assert.equal(options.timeout, 4000);
      idleCallback = callback;
      return 7;
    },
    cancelIdleCallback() {},
  };
  const dispose = scheduleDashboardWarmup({
    isOpen: () => false,
    ensureInitialLoad: async () => { calls += 1; },
  }, { windowLike });

  assert.equal(calls, 0);
  idleCallback();
  await Promise.resolve();
  assert.equal(calls, 1);
  dispose();
});

test("dashboard warm-up is cancelled during unload", () => {
  let idleCallback = null;
  let cancelled = null;
  let calls = 0;
  const windowLike = {
    requestIdleCallback(callback) { idleCallback = callback; return 19; },
    cancelIdleCallback(id) { cancelled = id; },
  };
  const dispose = scheduleDashboardWarmup({
    ensureInitialLoad: () => { calls += 1; },
  }, { windowLike });

  dispose();
  idleCallback();
  assert.equal(cancelled, 19);
  assert.equal(calls, 0);
});

test("dashboard warm-up does not compete with an already open dashboard", () => {
  let idleCallback = null;
  let calls = 0;
  const windowLike = {
    requestIdleCallback(callback) { idleCallback = callback; return 1; },
    cancelIdleCallback() {},
  };
  scheduleDashboardWarmup({
    isOpen: () => true,
    ensureInitialLoad: () => { calls += 1; },
  }, { windowLike });

  idleCallback();
  assert.equal(calls, 0);
});

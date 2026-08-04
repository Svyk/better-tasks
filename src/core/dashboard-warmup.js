/**
 * Warm the dashboard model after Roam reaches an idle slice.
 *
 * This keeps the extension's startup path light while removing the graph-wide
 * task collection from the first dashboard click. The returned disposer is
 * safe to call whether the callback has fired or not.
 */
export function scheduleDashboardWarmup(
  controller,
  { windowLike = globalThis.window, timeoutMs = 4000 } = {}
) {
  if (!controller || typeof controller.ensureInitialLoad !== "function") return () => {};

  let disposed = false;
  let idleId = null;
  let timerId = null;
  const run = () => {
    idleId = null;
    timerId = null;
    if (disposed || controller.isOpen?.()) return;
    try {
      const result = controller.ensureInitialLoad();
      result?.catch?.((error) => {
        console.warn("[BetterTasks] dashboard warm-up failed", error);
      });
    } catch (error) {
      console.warn("[BetterTasks] dashboard warm-up failed", error);
    }
  };

  if (typeof windowLike?.requestIdleCallback === "function") {
    idleId = windowLike.requestIdleCallback(run, { timeout: timeoutMs });
  } else {
    timerId = windowLike?.setTimeout?.(run, Math.min(timeoutMs, 1500));
  }

  return () => {
    disposed = true;
    if (idleId != null) windowLike?.cancelIdleCallback?.(idleId);
    if (timerId != null) windowLike?.clearTimeout?.(timerId);
    idleId = null;
    timerId = null;
  };
}

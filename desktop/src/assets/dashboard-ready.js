(function () {
  const load = window.__OCTOP_DASHBOARD_LOAD__;
  if (!load || window.__OCTOP_PAGE_LEAVING__) return;
  const expected = new URL(load.base);
  if (
    location.hostname !== expected.hostname ||
    (expected.protocol === "https:" && location.protocol !== "https:") ||
    !["http:", "https:"].includes(location.protocol)
  )
    return;
  if (window.__OCTOP_DASHBOARD_WATCH__ === load.id) return;
  window.__OCTOP_DASHBOARD_WATCH__ = load.id;

  let observer;
  let timeout;
  function cleanup() {
    observer.disconnect();
    clearTimeout(timeout);
  }
  function check() {
    const root = document.getElementById("root");
    const invoke = window._wails?.invoke;
    if (!root?.firstElementChild || typeof invoke !== "function") return;
    cleanup();
    invoke("wails:event:emit:desktop:dashboard-ready:" + load.id);
  }
  observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  timeout = setTimeout(cleanup, 45000);
  check();
})();

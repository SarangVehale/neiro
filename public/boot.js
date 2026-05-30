// SW registration moved out of index.html so we can drop 'unsafe-inline'
// from script-src in the meta CSP (audit item #2).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}

export function renderDashboardThemeExtension(): string {
  return String.raw`
<style id="wb-dashboard-theme-extension">
  /* These modules are independently injected and contain inline dark presentation values.
     Keep this layer last so the selected dashboard theme is authoritative across them. */
  #wbModelManager,
  #wbKeyManager,
  #simulatorShell,
  #simulatorShell .sim-panel {
    background:var(--wb-panel) !important;
    color:var(--wb-text) !important;
    border-color:var(--wb-line) !important;
  }

  #wbModelManager .wb-model-card,
  #wbModelManager .wb-role,
  #wbKeyManager .wb-key-card,
  #simulatorShell .sim-card,
  #simulatorShell .sim-kv,
  #simulatorShell .sim-run,
  #simulatorShell .sim-tab,
  #simulatorShell .sim-textarea,
  #simulatorShell .sim-input,
  #simulatorShell .sim-select {
    background:var(--wb-panel-2) !important;
    color:var(--wb-text) !important;
    border-color:var(--wb-line) !important;
  }

  #wbModelManager .wb-model-card.preferred-legacy,
  #wbModelManager .wb-editing,
  #wbKeyManager .wb-key-card,
  #simulatorShell .sim-result {
    border-color:var(--wb-line) !important;
  }

  #wbModelManager .wb-role,
  #wbModelManager .wb-provider-note,
  #wbModelManager .wb-catalog-meta,
  #wbModelManager .wb-help,
  #wbKeyManager [data-key-loading],
  #simulatorShell .sim-label,
  #simulatorShell .sim-check,
  #simulatorShell .sim-run-msg {
    color:var(--wb-muted) !important;
  }

  #wbModelManager .mono,
  #wbKeyManager .mono {
    color:var(--wb-blue,#5aa7ff) !important;
  }

  #wbModelManager input,
  #wbModelManager select,
  #wbModelManager button:not(.danger),
  #wbKeyManager input,
  #wbKeyManager select,
  #wbKeyManager button:not(.danger),
  #simulatorShell input,
  #simulatorShell select,
  #simulatorShell textarea,
  #simulatorShell button:not(.primary) {
    background:var(--wb-panel-3) !important;
    color:var(--wb-text) !important;
    border-color:var(--wb-line) !important;
  }

  #wbModelManager input::placeholder,
  #wbKeyManager input::placeholder,
  #simulatorShell input::placeholder,
  #simulatorShell textarea::placeholder {
    color:var(--wb-muted) !important;
  }

  #wbModelManager button:hover,
  #wbKeyManager button:hover,
  #simulatorShell button:hover,
  #simulatorShell .sim-tab:hover {
    background:var(--wb-nav-active) !important;
    border-color:var(--wb-line-strong) !important;
  }

  #wbModelManager .btn.primary,
  #wbKeyManager .btn.primary,
  #simulatorShell .btn.primary {
    background:var(--wb-primary,#2563eb) !important;
    color:#fff !important;
    border-color:var(--wb-primary,#2563eb) !important;
  }

  #wbModelManager .btn.danger,
  #wbKeyManager .btn.danger,
  #simulatorShell .btn.danger {
    background:var(--wb-danger-bg,rgba(255,102,117,.10)) !important;
    color:var(--wb-danger,#ff9aa4) !important;
    border-color:var(--wb-danger-border,rgba(255,102,117,.30)) !important;
  }

  #wbModelManager [style*="background:#0a1626"],
  #wbModelManager [style*="background:#091524"],
  #wbModelManager [style*="background:#0d1a2b"],
  #wbKeyManager [style*="background:#0a1626"],
  #wbKeyManager [style*="background:#091524"],
  #wbKeyManager [style*="background:#0f172a"],
  #wbKeyManager [style*="background:#111827"],
  #simulatorShell [style*="background:#0a1626"],
  #simulatorShell [style*="background:#091524"],
  #simulatorShell [style*="background:#081321"],
  #simulatorShell [style*="background:#0a1626"] {
    background:var(--wb-panel-2) !important;
  }

  #wbModelManager [style*="border-top:1px solid"],
  #wbKeyManager [style*="border-top:1px solid"],
  #simulatorShell [style*="border-top:1px solid"],
  #simulatorShell [style*="border:1px solid #1e293b"],
  #simulatorShell [style*="border:1px solid #334155"] {
    border-color:var(--wb-line) !important;
  }

  #simulatorShell .sim-tab.active {
    color:var(--wb-text) !important;
    background:var(--wb-nav-active) !important;
    border-color:var(--wb-line-strong) !important;
  }

  #simulatorShell .sim-result,
  #simulatorShell .sim-run,
  #simulatorShell .sim-card,
  #simulatorShell .sim-kv {
    box-shadow:none;
  }

  html[data-wb-theme="light"] {
    --wb-primary:#2563eb;
    --wb-danger:#b42332;
    --wb-danger-bg:rgba(180,35,50,.08);
    --wb-danger-border:rgba(180,35,50,.24);
    --wb-blue:#2563eb;
  }

  html[data-wb-theme="dark"] {
    --wb-primary:#2563eb;
    --wb-danger:#fecaca;
    --wb-danger-bg:#2a0d12;
    --wb-danger-border:#7f1d1d;
    --wb-blue:#5aa7ff;
  }

  @media (prefers-color-scheme:light) {
    html:not([data-wb-theme="dark"]) {
      --wb-primary:#2563eb;
      --wb-danger:#b42332;
      --wb-danger-bg:rgba(180,35,50,.08);
      --wb-danger-border:rgba(180,35,50,.24);
      --wb-blue:#2563eb;
    }
  }
</style>`;
}

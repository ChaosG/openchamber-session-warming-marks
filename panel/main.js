(function () {
  const root = document.documentElement;

  function applyTheme(value) {
    const mode = typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? (value.mode || value.theme || value.appearance)
        : null;
    if (mode === 'dark' || mode === 'light') {
      root.style.colorScheme = mode;
      root.dataset.theme = mode;
    }
  }

  window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'theme') {
      applyTheme(data.theme || data.value || data);
    } else if (data.type === 'ready' && data.theme) {
      applyTheme(data.theme);
    }
  });

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.dataset.theme = 'dark';
  }
})();

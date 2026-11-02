export function applyTheme(theme) {
  const themes = new Set(["light", "github", "catppuccin", "godzilla", "amoled"]);
  if (themes.has(theme)) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

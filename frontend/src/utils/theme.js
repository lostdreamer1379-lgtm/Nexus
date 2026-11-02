export function applyTheme(theme) {
  const themes = new Set(["light", "github", "catppuccin", "godzilla", "amoled"]);
  if (themes.has(theme)) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export const THEME_OPTIONS = [
  ["dark", "Dark"],
  ["amoled", "AMOLED black"],
  ["light", "Light"],
  ["github", "GitHub"],
  ["catppuccin", "Catppuccin"],
  ["godzilla", "AMOLED Godzilla"],
];

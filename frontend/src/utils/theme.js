export function applyTheme(theme) {
  if (theme === "amoled") {
    document.documentElement.dataset.theme = "amoled";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

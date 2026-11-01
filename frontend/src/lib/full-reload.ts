export function fullReload(path: string, replace = false) {
  if (replace) window.location.replace(path);
  else window.location.assign(path);
}

// Results are server-rendered. Native navigation avoids leaving filter controls
// pending on an interrupted client-router stream; mobile changes are batched first.
export function navigateSearch(url: string) {
  window.location.assign(url);
}

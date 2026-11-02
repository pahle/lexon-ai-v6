let routeHeadingFocusPending = false;

export function requestRouteHeadingFocus() {
  routeHeadingFocusPending = true;
}

export function consumeRouteHeadingFocus() {
  const pending = routeHeadingFocusPending;
  routeHeadingFocusPending = false;
  return pending;
}

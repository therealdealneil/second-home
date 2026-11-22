type DismissibleRouter = {
  canDismiss: () => boolean;
  dismiss: () => void;
  replace: (href: "/") => void;
};

/**
 * Dismisses a modal/formSheet back to the map, or replaces the stack with `/`
 * when launched directly onto a sheet route via Universal/App Link cold start.
 */
export function dismissOrReturnHome(router: DismissibleRouter): void {
  if (router.canDismiss()) {
    router.dismiss();
  } else {
    router.replace("/");
  }
}

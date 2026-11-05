export type SettingsSection =
  'profile' | 'appearance' | 'security' | 'members' | 'invitations' | 'general';

const sections = new Set<SettingsSection>([
  'profile',
  'appearance',
  'security',
  'members',
  'invitations',
  'general',
]);

let settingsOpener: HTMLElement | null = null;

export function rememberSettingsOpener(opener: HTMLElement | null) {
  settingsOpener = opener;
}

export function getSettingsOpener() {
  return settingsOpener;
}

export function readSettingsSection(
  search: URLSearchParams,
): SettingsSection | 'invalid' | null {
  const values = search.getAll('settings');
  if (values.length === 0) return null;
  if (
    values.length !== 1 ||
    !values[0] ||
    !sections.has(values[0] as SettingsSection)
  )
    return 'invalid';
  return values[0] as SettingsSection;
}

export function settingsHref(
  url: string,
  section: SettingsSection | null,
): string {
  const parsed = new URL(url, 'http://localhost');
  parsed.searchParams.delete('settings');
  if (section) parsed.searchParams.set('settings', section);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function getSettingsFinalFocusTarget(
  opener: HTMLElement | null,
  fallback: HTMLElement | null,
): HTMLElement | true {
  const isAvailable = (
    candidate: HTMLElement | null,
  ): candidate is HTMLElement =>
    !!candidate &&
    candidate.isConnected &&
    !candidate.closest('[inert], [hidden]');

  if (isAvailable(opener) && opener.getClientRects().length > 0) {
    const mobileSidebar = opener.closest<HTMLElement>(
      '[data-sidebar="sidebar"][data-mobile="true"]',
    );
    if (!mobileSidebar || mobileSidebar.hasAttribute('data-open'))
      return opener;
  }

  return isAvailable(fallback) ? fallback : true;
}

'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../shell/workspace-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { X } from 'lucide-react';
import { SettingsNavigation } from './settings-navigation';
import {
  getSettingsFinalFocusTarget,
  getSettingsOpener,
  readSettingsSection,
  rememberSettingsOpener,
  settingsHref,
} from './settings-url';
import { ProfileSettings } from './profile-settings';
import { AppearanceSettings } from './appearance-settings';
import { AccountSecurity } from '../auth/account-security';
import { Members } from '../organizations/members';
import { Invitations } from '../organizations/invitations';
import { OrganizationSettings } from '../organizations/organization-settings';

export function SettingsDialog(): React.ReactElement | null {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { identity, status } = useWorkspace();
  const section = readSettingsSection(
    new URLSearchParams(searchParams.toString()),
  );
  const opener = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const hasOpened = useRef(section !== null);
  if (section !== null) hasOpened.current = true;
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const previousOrganizationId = useRef(identity?.organization.id);
  opener.current = getSettingsOpener();

  const replaceSection = (next: Parameters<typeof settingsHref>[1]) => {
    router.replace(settingsHref(window.location.href, next), { scroll: false });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        if (sectionRef.current !== null) return;
        opener.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        rememberSettingsOpener(opener.current);
        replaceSection('profile');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const canShowSecurity = status === 'ready' || status === 'mfa-required';
  const canShowSection =
    status === 'ready' && !!identity && identity.user.onboardingCompleted;
  const team = identity?.organization.kind === 'team';
  const allowed =
    section === 'invalid'
      ? false
      : section === 'security'
        ? canShowSecurity
        : canShowSection &&
          (section === 'profile' ||
            section === 'appearance' ||
            (team &&
              (section === 'members' ||
                ((identity.organization.role === 'owner' ||
                  identity.organization.role === 'admin') &&
                  section === 'invitations') ||
                (identity.organization.role === 'owner' &&
                  section === 'general'))));

  useLayoutEffect(() => {
    const previousId = previousOrganizationId.current;
    const currentId = identity?.organization.id;
    previousOrganizationId.current = currentId;
    if (!previousId || previousId === currentId) return;
    const queryKey = ['tenant', previousId];
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [identity?.organization.id, queryClient]);

  useLayoutEffect(() => {
    const isOrganizationSection =
      section === 'members' ||
      section === 'invitations' ||
      section === 'general';
    if (!isOrganizationSection || allowed || !identity?.organization) return;
    const queryKey = ['tenant', identity.organization.id];
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [allowed, identity?.organization, queryClient, section]);

  if (section === null && !hasOpened.current) return null;

  return (
    <Dialog
      open={section !== null}
      onOpenChange={(open) => {
        if (!open) replaceSection(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={titleRef}
        finalFocus={() =>
          getSettingsFinalFocusTarget(
            opener.current,
            document.querySelector<HTMLElement>(
              'button[aria-label="Open navigation"]',
            ),
          )
        }
        className="flex h-[min(42.5rem,calc(100dvh-2rem))] w-full max-w-[1000px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]"
      >
        <DialogHeader className="shrink-0 flex-row items-center justify-between border-b px-5 py-3">
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
            Settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Manage your account and workspace preferences.
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close settings"
            onClick={() => replaceSection(null)}
          >
            <X aria-hidden="true" />
          </Button>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden min-[768px]:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-b min-[768px]:border-r min-[768px]:border-b-0">
            <SettingsNavigation
              section={section}
              recoveryOnly={
                status === 'mfa-required' || !identity?.user.onboardingCompleted
              }
            />
          </aside>
          <section
            aria-label={
              section === 'invalid'
                ? 'Unavailable settings section'
                : `${section} settings`
            }
            className="min-h-0 overflow-y-auto px-8 py-6"
          >
            {!allowed ? (
              <div className="flex min-h-40 flex-col items-start justify-center gap-3">
                <h2 className="font-serif text-xl">No access</h2>
                <p className="text-sm text-muted-foreground">
                  You do not have access to this section.
                </p>
              </div>
            ) : section === 'profile' ? (
              <ProfileSettings />
            ) : section === 'appearance' ? (
              <AppearanceSettings />
            ) : section === 'security' ? (
              <AccountSecurity />
            ) : section === 'members' && identity ? (
              <Members
                key={identity.organization.id}
                organization={identity.organization}
              />
            ) : section === 'invitations' && identity ? (
              <Invitations
                key={identity.organization.id}
                organization={identity.organization}
              />
            ) : section === 'general' && identity ? (
              <OrganizationSettings
                key={identity.organization.id}
                organization={identity.organization}
                embeddedInSettings
              />
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

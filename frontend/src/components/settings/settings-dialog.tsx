'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { ArrowLeft, X } from 'lucide-react';
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

/** The dialog has one fixed size whatever the section (LEX-DS-001 §5.5). */
export const settingsDialogClass =
  'flex h-[680px] w-[1000px] max-w-none flex-col gap-0 overflow-hidden rounded-[12px] border border-border p-0 shadow-[0_0_0_1px_rgba(26,23,24,.08),0_16px_40px_-12px_rgba(8,6,6,.22)] ring-0 sm:max-w-none dark:shadow-[0_0_0_1px_#2C2829,0_16px_40px_-12px_#000] max-md:inset-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0';

const sectionNames: Record<string, string> = {
  profile: 'Profile',
  appearance: 'Appearance',
  security: 'Security',
  members: 'Members',
  invitations: 'Invitations',
  general: 'General',
};

export function SettingsDialog(): React.ReactElement | null {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { identity, status } = useWorkspace();
  const section = readSettingsSection(
    new URLSearchParams(searchParams.toString()),
  );
  const opener = useRef<HTMLElement | null>(null);
  // Mobile only: the sheet shows either the sections or one section.
  const [showSections, setShowSections] = useState(false);
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

  useEffect(() => {
    if (section === null) setShowSections(false);
  }, [section]);

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
        className={settingsDialogClass}
      >
        <DialogHeader className="h-14 shrink-0 flex-row items-center justify-between gap-2 border-b py-0 pr-4 pl-6 max-md:px-2">
          {!showSections && section !== null && section !== 'invalid' ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to sections"
              className="md:hidden"
              onClick={() => setShowSections(true)}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
          ) : null}
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-base font-semibold outline-none max-md:flex-1 max-md:text-center"
          >
            <span className={showSections ? '' : 'max-md:sr-only'}>
              Settings
            </span>
            {!showSections && section ? (
              <span aria-hidden="true" className="md:hidden">
                {sectionNames[section] ?? ''}
              </span>
            ) : null}
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
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside
            className={`overflow-y-auto bg-sidebar md:block md:border-r md:border-sidebar-border ${showSections ? '' : 'max-md:hidden'}`}
          >
            <SettingsNavigation
              onSelect={() => setShowSections(false)}
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
            className={`min-h-0 overflow-y-auto px-8 py-7 max-md:px-4 max-md:py-5 ${showSections ? 'max-md:hidden' : ''}`}
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

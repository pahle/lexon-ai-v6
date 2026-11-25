import { z } from 'zod';
import {
  UuidSchema,
  DisplayNameSchema,
  EmailAddressSchema,
} from './identity.js';
import { OrgRoleSchema } from './organizations.js';

const uuid = UuidSchema;
const timestamp = z.iso.datetime();

// Bounds mirror the app.projects CHECK constraints (spec §3): char_length,
// counted the same way RenameChatInputSchema counts characters.
const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => Array.from(value).length <= max, {
      error: `Text must be at most ${max.toLocaleString('en-US')} characters`,
    });
const projectName = boundedText(120);
const matterNumber = boundedText(64);
const practiceArea = boundedText(120);

export const ProjectCreateInputSchema = z.strictObject({
  name: projectName,
  matterNumber: matterNumber.optional(),
  practiceArea: practiceArea.optional(),
});
export type ProjectCreateInput = z.infer<typeof ProjectCreateInputSchema>;

export const ProjectSettingsInputSchema = z
  .strictObject({
    name: projectName.optional(),
    // Nullable so settings can clear optional metadata explicitly.
    matterNumber: matterNumber.nullable().optional(),
    practiceArea: practiceArea.nullable().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.matterNumber !== undefined ||
      input.practiceArea !== undefined,
    { message: 'Choose a setting to update.' },
  );
export type ProjectSettingsInput = z.infer<typeof ProjectSettingsInputSchema>;

export const ProjectInstructionsInputSchema = z.strictObject({
  // Null clears the document (the row is deleted); the API shape is
  // `instructions: string | null`.
  instructions: z
    .string()
    .refine((value) => Array.from(value).length <= 8_000, {
      error: 'Text must be at most 8,000 characters',
    })
    .nullable(),
});
export type ProjectInstructionsInput = z.infer<
  typeof ProjectInstructionsInputSchema
>;

// The single owner is implied by projects.owner_user_id and is never a member
// row, so assignable roles exclude 'owner'.
export const ProjectRoleSchema = z.enum(['viewer', 'editor']);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

// A caller's standing on a project, owner included (access definers return
// this vocabulary plus 'none', which never crosses the wire).
export const ProjectAccessSchema = z.enum(['owner', 'editor', 'viewer']);
export type ProjectAccess = z.infer<typeof ProjectAccessSchema>;

export const MemberAddInputSchema = z.strictObject({
  userId: uuid,
  role: ProjectRoleSchema,
});
export type MemberAddInput = z.infer<typeof MemberAddInputSchema>;

export const MemberRoleInputSchema = z.strictObject({
  role: ProjectRoleSchema,
});
export type MemberRoleInput = z.infer<typeof MemberRoleInputSchema>;

export const DenyAddInputSchema = z.strictObject({
  userId: uuid,
});
export type DenyAddInput = z.infer<typeof DenyAddInputSchema>;

export const ShareAddInputSchema = z.strictObject({
  userIds: z.array(uuid).min(1).max(50),
});
export type ShareAddInput = z.infer<typeof ShareAddInputSchema>;

const projectOwner = z.strictObject({
  userId: uuid,
  name: DisplayNameSchema,
});

export const ProjectSummarySchema = z.strictObject({
  version: z.literal(1),
  id: uuid,
  name: projectName,
  matterNumber: matterNumber.nullable(),
  practiceArea: practiceArea.nullable(),
  owner: projectOwner,
  myRole: ProjectAccessSchema,
  memberCount: z.number().int().nonnegative().safe(),
  chatCount: z.number().int().nonnegative().safe(),
  lastActivityAt: timestamp,
  createdAt: timestamp,
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectPageSchema = z.strictObject({
  items: z.array(ProjectSummarySchema),
  pageInfo: z.strictObject({ nextCursor: z.string().max(256).nullable() }),
});
export type ProjectPage = z.infer<typeof ProjectPageSchema>;

// Org owner/admin metadata list: project-identifying metadata only — never
// instructions, member identities or the caller's role.
export const OrgProjectSummarySchema = z.strictObject({
  version: z.literal(1),
  id: uuid,
  name: projectName,
  matterNumber: matterNumber.nullable(),
  practiceArea: practiceArea.nullable(),
  owner: projectOwner,
  memberCount: z.number().int().nonnegative().safe(),
  chatCount: z.number().int().nonnegative().safe(),
  lastActivityAt: timestamp,
  createdAt: timestamp,
});
export type OrgProjectSummary = z.infer<typeof OrgProjectSummarySchema>;

// project_members is keyed by (org, project, user): the member's identity in
// the project is their user id — memberId mirrors it for client keying.
export const ProjectMemberSummarySchema = z.strictObject({
  version: z.literal(1),
  memberId: uuid,
  userId: uuid,
  name: DisplayNameSchema,
  email: EmailAddressSchema,
  role: ProjectRoleSchema,
  createdAt: timestamp,
});
export type ProjectMemberSummary = z.infer<typeof ProjectMemberSummarySchema>;

export const DenySummarySchema = z.strictObject({
  version: z.literal(1),
  userId: uuid,
  name: DisplayNameSchema,
  email: EmailAddressSchema,
  setByUserId: uuid,
  createdAt: timestamp,
});
export type DenySummary = z.infer<typeof DenySummarySchema>;

export const ChatShareSummarySchema = z.strictObject({
  version: z.literal(1),
  userId: uuid,
  name: DisplayNameSchema,
  email: EmailAddressSchema,
  grantedByUserId: uuid,
  createdAt: timestamp,
});
export type ChatShareSummary = z.infer<typeof ChatShareSummarySchema>;

const listQuery = {
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

export const MattersListQuerySchema = z.strictObject({
  ...listQuery,
  filter: z.enum(['all', 'owned', 'shared']).default('all'),
  sort: z.enum(['name', 'activity']).default('activity'),
});
export type MattersListQuery = z.infer<typeof MattersListQuerySchema>;

export const OrgProjectsQuerySchema = z.strictObject({ ...listQuery });
export type OrgProjectsQuery = z.infer<typeof OrgProjectsQuerySchema>;

export const OrgMemberSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type OrgMemberSearchQuery = z.infer<typeof OrgMemberSearchQuerySchema>;

// Picker row for member/share/deny target selection over current org members.
export const OrgMemberSummarySchema = z.strictObject({
  version: z.literal(1),
  userId: uuid,
  name: DisplayNameSchema,
  email: EmailAddressSchema,
  role: OrgRoleSchema,
});
export type OrgMemberSummary = z.infer<typeof OrgMemberSummarySchema>;

export const OrgMemberSearchResultSchema = z.strictObject({
  items: z.array(OrgMemberSummarySchema),
});
export type OrgMemberSearchResult = z.infer<typeof OrgMemberSearchResultSchema>;

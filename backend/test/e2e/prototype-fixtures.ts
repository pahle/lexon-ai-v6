// Content of the F4.1 visual set, read from the approved prototype
// (docs/design/f4.1-prototype/source/prototype.html, revision 14). Synthetic
// data only. Every group spec and chat-state-fixtures.ts import from here so
// a capture reads exactly like its prototype state.

/**
 * The one instant every capture runs on: Saturday 14 Nov 2026, 11:00 in
 * Asia/Jakarta. It gives "Good morning", "Today" for 10:42 (03:42Z), "Yesterday"
 * for 13 Nov, and the provisioning date "14 Nov 2026, 11:00". Seven days
 * later is the "21 Nov 2026" invitation expiry.
 */
export const prototypeNow = '2026-11-14T04:00:00.000Z';
export const prototypeTimeZone = 'Asia/Jakarta';

/** An instant on 14 Nov 2026 (Jakarta) at the given local time. */
const jakarta = (day: string, time: string) =>
  `${day}T${String(Number(time.slice(0, 2)) - 7).padStart(2, '0')}:${time.slice(3)}:00.000Z`;

export const ayu = {
  name: 'Ayu Wardani',
  firstName: 'Ayu',
  jobTitle: 'Senior Associate',
  email: 'ayu@hukum-nusantara.co.id',
  initials: 'AW',
} as const;

export const team = {
  name: 'Hukum Nusantara',
  slug: 'hukum-nusantara',
  initials: 'HN',
  members: [
    { ...ayu, role: 'owner' as const },
    {
      name: 'Rizky Pratama',
      email: 'rizky@hukum-nusantara.co.id',
      role: 'admin' as const,
      initials: 'RP',
    },
    {
      name: 'Sari Wibowo',
      email: 'sari@hukum-nusantara.co.id',
      role: 'member' as const,
      initials: 'SW',
    },
  ],
} as const;

export const otherOrganization = {
  name: 'Pro Bono Clinic',
  slug: 'pro-bono-clinic',
  initials: 'PB',
} as const;

/** Pending invitations in Settings, with the expiry the prototype shows. */
export const teamInvitations = [
  {
    email: 'dimas@hukum-nusantara.co.id',
    role: 'member' as const,
    expiresAt: jakarta('2026-11-25', '11:00'),
    shown: '25 Nov 2026',
  },
  {
    email: 'lina@hukum-nusantara.co.id',
    role: 'admin' as const,
    expiresAt: jakarta('2026-11-24', '11:00'),
    shown: '24 Nov 2026',
  },
  {
    email: 'bagus@hukum-nusantara.co.id',
    role: 'member' as const,
    expiresAt: jakarta('2026-11-12', '11:00'),
    shown: '12 Nov 2026',
    expired: true,
  },
] as const;

/** The invitation Rizky Pratama sent Ayu (accept-invitation, onboarding). */
export const invitationToTeam = {
  inviter: 'Rizky Pratama',
  role: 'member' as const,
  expiresAt: jakarta('2026-11-21', '11:00'),
  shown: '21 Nov 2026',
} as const;

export const chatTitles = {
  newChat: 'Syarat sah perjanjian (Pasal 1320)',
  acquisition: 'Due diligence checklist for PT acquisition',
  employment: 'PKWT vs PKWTT after the Job Creation Law',
  forceMajeure: 'Force majeure clause, supply agreement',
  default: 'Wanprestasi remedies and damages',
  data: 'Data transfer under UU PDP Article 56',
} as const;

/** Chats in Recent order. `shown` is the label Chats history prints. */
export const chatTimes = {
  newChat: {
    at: jakarta('2026-11-14', '10:42'),
    shown: '10:42',
    group: 'Today',
  },
  acquisition: {
    at: jakarta('2026-11-14', '10:42'),
    shown: '10:42',
    group: 'Today',
  },
  employment: {
    at: jakarta('2026-11-13', '10:42'),
    shown: 'Yesterday',
    group: 'Yesterday',
  },
  forceMajeure: {
    at: jakarta('2026-11-04', '10:42'),
    shown: 'Nov 4',
    group: 'Previous 7 days',
  },
  default: {
    at: jakarta('2026-11-04', '10:42'),
    shown: 'Nov 4',
    group: 'Previous 7 days',
  },
  data: {
    at: jakarta('2026-11-04', '10:42'),
    shown: 'Nov 4',
    group: 'Previous 7 days',
  },
} as const;

export const question =
  'Apa saja syarat sahnya perjanjian menurut KUHPerdata, dan apa akibatnya jika salah satu syarat tidak terpenuhi?';

export const reasoningSummary =
  'The question asks for the validity conditions in Article 1320 of the Civil Code. List the four conditions, separate subjective from objective conditions, and explain voidable versus void by law.';

export const answer = `Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:

1. **Kesepakatan** para pihak yang mengikatkan dirinya.
2. **Kecakapan** untuk membuat suatu perikatan.
3. **Suatu hal tertentu** sebagai objek perjanjian.
4. **Suatu sebab yang halal**.

### Akibat jika syarat tidak terpenuhi

- Syarat 1 dan 2 adalah **syarat subjektif**. Jika tidak terpenuhi, perjanjian **dapat dibatalkan** atas permintaan pihak yang dirugikan.
- Syarat 3 dan 4 adalah **syarat objektif**. Jika tidak terpenuhi, perjanjian **batal demi hukum**, dianggap tidak pernah ada.`;

/** Search results for "wanprestasi" in Chats, as the prototype prints them. */
export const searchResults = [
  {
    title: chatTitles.default,
    shown: 'Nov 4',
    excerpt:
      '…debitur yang melakukan wanprestasi dapat dituntut pemenuhan perikatan, ganti rugi, atau pembatalan perjanjian berdasarkan Pasal 1267…',
  },
  {
    title: chatTitles.forceMajeure,
    shown: 'Nov 5',
    excerpt:
      '…keadaan memaksa membebaskan debitur dari tanggung jawab atas wanprestasi jika peristiwa tidak dapat diduga…',
  },
  {
    title: chatTitles.newChat,
    shown: 'Today',
    excerpt:
      '…berbeda dengan wanprestasi, cacat pada syarat subjektif membuat perjanjian dapat dibatalkan…',
  },
] as const;

export const platformAdmin = {
  name: 'Dimas Prasetyo',
  initials: 'DP',
  // The prototype shows no address for the platform administrator.
  email: 'dimas.prasetyo.bv@example.test',
} as const;

/**
 * Provisioning organizations of the platform world, with the first owner
 * emails of revision 16 (`PO` in prototype.src.html).
 */
export const provisioningOrganizations = [
  {
    name: 'Harbor Legal Partners',
    slug: 'harbor-legal-partners',
    ownerEmail: 'owner@harborlegal.co.id',
    expiresAt: jakarta('2026-11-21', '11:00'),
  },
  {
    name: 'Kantor Hukum Wibowo',
    slug: 'kantor-hukum-wibowo',
    ownerEmail: 'andi@khwibowo.co.id',
  },
  {
    name: 'Sinar Hukum',
    slug: 'sinar-hukum',
    ownerEmail: 'bagus@sinarhukum.co.id',
  },
] as const;

// Platform console (F4.3), revision 16 of the prototype
// (docs/design/f4.1-prototype/source/prototype.src.html: `PA`, `PO`,
// platformInvitationsList, platformAccountDetail, platformOrgActive,
// platformOrgProvisioning). Dates are calendar days in Asia/Jakarta.

/** A calendar day in Asia/Jakarta (10:00 local). */
const day = (date: string) => jakarta(date, '10:00');

/** The prototype's Accounts tab count (the list shows its first 10 rows). */
export const platformAccountsTotal = 248;

/**
 * The prototype's accounts, in its row order. `lastActive` turns the
 * prototype's relative labels into instants on the frozen clock: "Active
 * now" is prototypeNow, "Today" 10:42, "Yesterday" 13 Nov, "N days ago"
 * 14 Nov minus N, "2 weeks ago" 31 Oct (the record page of Lina Hartono).
 */
export const platformAccounts = [
  {
    key: 'admin',
    name: 'Dimas Prasetyo',
    email: 'dimas@lexon.id',
    status: 'active',
    twoFactor: true,
    teams: 0,
    joined: day('2026-09-01'),
    lastActive: prototypeNow,
    admin: true,
  },
  {
    key: 'ayu',
    name: 'Ayu Wardani',
    email: 'ayu@hukum-nusantara.co.id',
    status: 'active',
    twoFactor: true,
    teams: 2,
    joined: day('2026-09-02'),
    lastActive: jakarta('2026-11-14', '10:42'),
  },
  {
    key: 'putri',
    name: 'Putri Anggraini',
    email: 'putri@probono.or.id',
    status: 'active',
    twoFactor: true,
    teams: 1,
    joined: day('2026-09-18'),
    lastActive: jakarta('2026-11-14', '10:42'),
  },
  {
    key: 'rizky',
    name: 'Rizky Pratama',
    email: 'rizky@hukum-nusantara.co.id',
    status: 'active',
    twoFactor: true,
    teams: 1,
    joined: day('2026-09-03'),
    lastActive: day('2026-11-13'),
  },
  {
    key: 'hendra',
    name: 'Hendra Gunawan',
    email: 'hendra@gunawanlaw.co.id',
    status: 'active',
    twoFactor: true,
    teams: 1,
    joined: day('2026-09-21'),
    lastActive: day('2026-11-12'),
  },
  {
    key: 'sari',
    name: 'Sari Wibowo',
    email: 'sari@hukum-nusantara.co.id',
    status: 'active',
    twoFactor: false,
    teams: 1,
    joined: day('2026-09-10'),
    lastActive: day('2026-11-11'),
  },
  {
    key: 'maya',
    name: 'Maya Lestari',
    email: 'maya.lestari@probono.or.id',
    status: 'active',
    twoFactor: false,
    teams: 1,
    joined: day('2026-09-25'),
    lastActive: day('2026-11-10'),
  },
  {
    key: 'andi',
    name: 'Andi Saputra',
    email: 'andi.saputra@gmail.com',
    status: 'active',
    twoFactor: false,
    teams: 0,
    joined: day('2026-10-02'),
    lastActive: day('2026-11-09'),
  },
  {
    key: 'unverified',
    name: 'Bagus Santoso',
    email: 'bagus@sinarhukum.co.id',
    status: 'unverified',
    twoFactor: false,
    teams: 0,
    joined: day('2026-11-12'),
    lastActive: null,
  },
  {
    key: 'disabled',
    name: 'Lina Hartono',
    email: 'lina@hukum-nusantara.co.id',
    status: 'disabled',
    twoFactor: false,
    teams: 1,
    joined: day('2026-09-05'),
    lastActive: day('2026-10-31'),
  },
] as const;

/** The three record pages: platformAccountDetail('active' | 'unverified' | 'disabled'). */
export const platformAccountRecords = {
  ayu: {
    id: '7f3d2a1e-9c4b-4e8a-b6d2-1a0c5e9f3b77',
    sessions: 3,
    teams: [
      { organization: 'team', role: 'owner' },
      { organization: 'other', role: 'member' },
    ],
  },
  unverified: {
    id: '0b9e41c2-7d3a-4f19-8e55-2c61a0f4d7b8',
    sessions: 0,
    teams: [],
  },
  disabled: {
    id: '5a2c7e90-1b4d-4c8e-9f36-7d0e8a1b2c43',
    sessions: 0,
    teams: [{ organization: 'team', role: 'member' }],
  },
} as const;

/** The Invitations tab (platformInvitationsList). */
export const platformInvitations = [
  {
    id: '00000000-0000-4000-8000-00000000f401',
    name: 'Rina Kusuma',
    email: 'rina@kusumalaw.co.id',
    status: 'pending',
    invitedBy: 'Dimas Prasetyo',
    sentAt: day('2026-11-19'),
    expiresAt: day('2026-11-26'),
  },
  {
    id: '00000000-0000-4000-8000-00000000f402',
    name: null,
    email: 'joko.santosa@gmail.com',
    status: 'expired',
    invitedBy: 'Dimas Prasetyo',
    sentAt: day('2026-11-02'),
    expiresAt: day('2026-11-09'),
  },
] as const;

/** The invite dialog's values (inviteDialog). */
export const platformInvitee = {
  email: 'rina@kusumalaw.co.id',
  name: 'Rina Kusuma',
} as const;

/** The Organizations list (`PO`), in its row order. */
export const platformOrganizations = [
  {
    key: 'team',
    name: 'Hukum Nusantara',
    slug: 'hukum-nusantara',
    state: 'active',
    members: 3,
    ownerEmail: 'ayu@hukum-nusantara.co.id',
    createdAt: day('2026-09-02'),
  },
  {
    key: 'other',
    name: 'Pro Bono Clinic',
    slug: 'pro-bono-clinic',
    state: 'active',
    members: 5,
    ownerEmail: 'putri@probono.or.id',
    createdAt: day('2026-09-18'),
  },
  {
    key: 'harbor-legal-partners',
    name: 'Harbor Legal Partners',
    slug: 'harbor-legal-partners',
    state: 'provisioning',
    members: 0,
    ownerEmail: 'owner@harborlegal.co.id',
    createdAt: prototypeNow,
  },
  {
    key: 'kantor-hukum-wibowo',
    name: 'Kantor Hukum Wibowo',
    slug: 'kantor-hukum-wibowo',
    state: 'provisioning',
    members: 0,
    ownerEmail: 'andi@khwibowo.co.id',
    createdAt: day('2026-11-13'),
  },
  {
    key: 'sinar-hukum',
    name: 'Sinar Hukum',
    slug: 'sinar-hukum',
    state: 'provisioning',
    members: 0,
    ownerEmail: 'bagus@sinarhukum.co.id',
    createdAt: day('2026-11-05'),
  },
] as const;

/** The active record page (platformOrgActive): Hukum Nusantara. */
export const platformActiveOrganization = {
  id: '3c8e1f6a-2b7d-4a90-8c15-e4d9b0a72f31',
  createdAt: day('2026-09-02'),
  members: [
    { email: ayu.email, joinedAt: day('2026-09-02') },
    { email: 'rizky@hukum-nusantara.co.id', joinedAt: day('2026-09-03') },
    { email: 'sari@hukum-nusantara.co.id', joinedAt: day('2026-09-10') },
  ],
} as const;

/** The provisioning record page (platformOrgProvisioning): Harbor Legal Partners. */
export const platformProvisioningOrganization = {
  id: '9d41b7e2-5c08-4f3a-a6e1-0b72c9d85e14',
  createdAt: prototypeNow,
  expiresAt: jakarta('2026-11-21', '11:00'),
} as const;

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

/** Organizations in "Awaiting first owner". */
export const provisioningOrganizations = [
  {
    name: 'Harbor Legal Partners',
    slug: 'harbor-legal-partners',
    ownerEmail: 'owner@harborlegal.co.id',
    status: 'Pending',
    expiresAt: jakarta('2026-11-21', '11:00'),
    shown: '21 Nov 2026',
    detail: {
      provisioned: '14 Nov 2026',
      sent: '14 Nov 2026, 11:00',
      expires: '21 Nov 2026, 11:00',
    },
  },
  {
    name: 'Sinar Hukum',
    slug: 'sinar-hukum',
    ownerEmail: 'owner@sinarhukum.co.id',
    status: 'Expired',
    expiresAt: jakarta('2026-11-12', '11:00'),
    shown: '12 Nov 2026',
  },
  {
    name: 'Kantor Hukum Wibowo',
    slug: 'kantor-hukum-wibowo',
    ownerEmail: 'owner@kantorwibowo.co.id',
    status: 'Pending',
    expiresAt: jakarta('2026-11-23', '11:00'),
    shown: '23 Nov 2026',
  },
] as const;

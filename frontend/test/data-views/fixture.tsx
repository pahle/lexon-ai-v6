import {
  IdentityCell,
  MoneyCell,
  NumberCell,
  OnOffDot,
  StatusBadge,
  TagCell,
  type DataColumn,
} from '../../src/components/data-views';

export type Person = {
  id: string;
  name: string;
  email: string;
  status: 'Active' | 'Unverified' | 'Disabled';
  tag: string;
  on: boolean;
  count: number;
  amount: number;
  date: string;
};

export const people: Person[] = [
  [
    'p1',
    'Ayu Wardani',
    'ayu@hukum-nusantara.co.id',
    'Active',
    'Owner',
    true,
    12,
    1250000,
    '2 Sep 2026',
  ],
  [
    'p2',
    'Bagus Santoso',
    'bagus@sinarhukum.co.id',
    'Unverified',
    'Member',
    false,
    0,
    0,
    '12 Nov 2026',
  ],
  [
    'p3',
    'Lina Hartono',
    'lina@hukum-nusantara.co.id',
    'Disabled',
    'Member',
    false,
    3,
    48000,
    '5 Sep 2026',
  ],
  [
    'p4',
    'Putri Anggraini',
    'putri@probono.or.id',
    'Active',
    'Admin',
    true,
    7,
    310000,
    '18 Sep 2026',
  ],
].map(([id, name, email, status, tag, on, count, amount, date]) => ({
  id,
  name,
  email,
  status,
  tag,
  on,
  count,
  amount,
  date,
})) as Person[];

export const columns: DataColumn<Person>[] = [
  {
    key: 'name',
    header: 'Record',
    cell: (p) => (
      <IdentityCell
        name={p.name}
        secondary={p.email}
        initials={p.name.slice(0, 2).toUpperCase()}
      />
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '116px',
    cell: (p) => (
      <StatusBadge
        tone={
          p.status === 'Active'
            ? 'neutral'
            : p.status === 'Unverified'
              ? 'warning'
              : 'inactive'
        }
      >
        {p.status}
      </StatusBadge>
    ),
  },
  {
    key: 'tag',
    header: 'Tag',
    width: '96px',
    cell: (p) => <TagCell>{p.tag}</TagCell>,
  },
  {
    key: 'on',
    header: 'State',
    width: '84px',
    cell: (p) => <OnOffDot on={p.on} />,
  },
  {
    key: 'count',
    header: 'Count',
    width: '72px',
    numeric: true,
    cell: (p) => <NumberCell value={p.count} />,
  },
  {
    key: 'amount',
    header: 'Amount',
    width: '130px',
    numeric: true,
    cell: (p) => <MoneyCell amount={p.amount} />,
  },
  {
    key: 'date',
    header: 'Date',
    width: '116px',
    muted: true,
    sortable: true,
    cell: (p) => p.date,
  },
];

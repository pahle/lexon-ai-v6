import { z } from 'zod';

// Indonesian national holidays and cuti bersama (joint leave) days, verbatim
// from the official SKB 3 Menteri decrees cited per year below (design spec
// §11). Days are plain calendar dates — weekends (Saturday/Sunday) are derived
// by the consumer and never listed here.
//
// Sources (read 2026-11-24):
// - 2026: setneg.go.id announcement of the lampiran (19 Sep 2025) + the decree
//   PDF on kemenkopmk.go.id — SKB 3 Menteri Nomor 1497/2/5 Tahun 2025.
// - 2027: kemnaker.go.id announcement of the lampiran (15 Sep 2026) + the
//   decree PDF on jdih.kemnaker.go.id — SKB 3 Menteri Nomor 1205/3/2 Tahun 2026.
//
// Annual update (one PR per year): append the next year's entry and bump
// `version`. The update is refused without an official SKB citation — the
// node --test guard in scripts/test/id-calendar-guard.spec.mjs fails once the
// last covered year's end is 90 days away.

export const CalendarDayKindSchema = z.enum(['holiday', 'cuti_bersama']);
export type CalendarDayKind = z.infer<typeof CalendarDayKindSchema>;

export const CalendarDaySchema = z.strictObject({
  date: z.iso.date(),
  name: z.string().min(1),
  kind: CalendarDayKindSchema,
});
export type CalendarDay = z.infer<typeof CalendarDaySchema>;

export const CalendarDecreeSchema = z.strictObject({
  numbers: z.array(z.string().min(1)).min(1),
  issued: z.iso.date(),
  title: z.string().min(1),
  sources: z.array(z.url({ protocol: /^https$/ })).min(1),
});
export type CalendarDecree = z.infer<typeof CalendarDecreeSchema>;

export const CalendarYearSchema = z.strictObject({
  decree: CalendarDecreeSchema,
  days: z.array(CalendarDaySchema).min(1),
});
export type CalendarYear = z.infer<typeof CalendarYearSchema>;

export const CalendarDataSchema = z.strictObject({
  version: z.string().min(1),
  years: z.record(z.string().regex(/^\d{4}$/), CalendarYearSchema),
});
export type CalendarData = z.infer<typeof CalendarDataSchema>;

export const ID_NATIONAL_CALENDAR = {
  version: 'id-national@2027.1',
  years: {
    2026: {
      decree: {
        numbers: ['1497/2025', '2/2025', '5/2025'],
        issued: '2025-09-19',
        title:
          'Keputusan Bersama Menteri Agama, Menteri Ketenagakerjaan, dan ' +
          'Menteri Pendayagunaan Aparatur Negara dan Reformasi Birokrasi ' +
          'tentang Hari Libur Nasional dan Cuti Bersama Tahun 2026',
        sources: [
          'https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026',
          'https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2025-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202026.pdf',
        ],
      },
      days: [
        { date: '2026-01-01', name: 'Tahun Baru 2026 Masehi', kind: 'holiday' },
        {
          date: '2026-01-16',
          name: 'Isra Mikraj Nabi Muhammad saw.',
          kind: 'holiday',
        },
        {
          date: '2026-02-16',
          name: 'Tahun Baru Imlek 2577 Kongzili',
          kind: 'cuti_bersama',
        },
        {
          date: '2026-02-17',
          name: 'Tahun Baru Imlek 2577 Kongzili',
          kind: 'holiday',
        },
        {
          date: '2026-03-18',
          name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)',
          kind: 'cuti_bersama',
        },
        {
          date: '2026-03-19',
          name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)',
          kind: 'holiday',
        },
        {
          date: '2026-03-20',
          name: 'Idulfitri 1447 H',
          kind: 'cuti_bersama',
        },
        { date: '2026-03-21', name: 'Idulfitri 1447 H', kind: 'holiday' },
        { date: '2026-03-22', name: 'Idulfitri 1447 H', kind: 'holiday' },
        {
          date: '2026-03-23',
          name: 'Idulfitri 1447 H',
          kind: 'cuti_bersama',
        },
        {
          date: '2026-03-24',
          name: 'Idulfitri 1447 H',
          kind: 'cuti_bersama',
        },
        { date: '2026-04-03', name: 'Wafat Yesus Kristus', kind: 'holiday' },
        {
          date: '2026-04-05',
          name: 'Kebangkitan Yesus Kristus (Paskah)',
          kind: 'holiday',
        },
        {
          date: '2026-05-01',
          name: 'Hari Buruh Internasional',
          kind: 'holiday',
        },
        {
          date: '2026-05-14',
          name: 'Kenaikan Yesus Kristus',
          kind: 'holiday',
        },
        {
          date: '2026-05-15',
          name: 'Kenaikan Yesus Kristus',
          kind: 'cuti_bersama',
        },
        { date: '2026-05-27', name: 'Iduladha 1447 H', kind: 'holiday' },
        {
          date: '2026-05-28',
          name: 'Iduladha 1447 H',
          kind: 'cuti_bersama',
        },
        {
          date: '2026-05-31',
          name: 'Hari Raya Waisak 2570 BE',
          kind: 'holiday',
        },
        { date: '2026-06-01', name: 'Hari Lahir Pancasila', kind: 'holiday' },
        {
          date: '2026-06-16',
          name: '1 Muharam Tahun Baru Islam 1448 H',
          kind: 'holiday',
        },
        {
          date: '2026-08-17',
          name: 'Proklamasi Kemerdekaan',
          kind: 'holiday',
        },
        {
          date: '2026-08-25',
          name: 'Maulid Nabi Muhammad saw.',
          kind: 'holiday',
        },
        {
          date: '2026-12-24',
          name: 'Kelahiran Yesus Kristus',
          kind: 'cuti_bersama',
        },
        {
          date: '2026-12-25',
          name: 'Kelahiran Yesus Kristus',
          kind: 'holiday',
        },
      ],
    },
    2027: {
      decree: {
        numbers: ['1205/2026', '3/2026', '2/2026'],
        issued: '2026-09-15',
        title:
          'Keputusan Bersama Menteri Agama, Menteri Ketenagakerjaan, dan ' +
          'Menteri Pendayagunaan Aparatur Negara dan Reformasi Birokrasi ' +
          'tentang Hari Libur Nasional dan Cuti Bersama Tahun 2027',
        sources: [
          'https://kemnaker.go.id/news/detail/pemerintah-tetapkan-18-hari-libur-nasional-dan-8-hari-cuti-bersama-tahun-2027',
          'https://jdih.kemnaker.go.id/asset/data_puu/2026skb003.pdf',
        ],
      },
      days: [
        { date: '2027-01-01', name: 'Tahun Baru 2027 Masehi', kind: 'holiday' },
        {
          date: '2027-01-05',
          name: 'Isra Mikraj Nabi Muhammad SAW 1448 Hijriah',
          kind: 'holiday',
        },
        {
          date: '2027-02-05',
          name: 'Tahun Baru Imlek 2578 Kongzili',
          kind: 'cuti_bersama',
        },
        {
          date: '2027-02-06',
          name: 'Tahun Baru Imlek 2578 Kongzili',
          kind: 'holiday',
        },
        {
          date: '2027-03-08',
          name: 'Hari Suci Nyepi (Tahun Baru Saka 1949)',
          kind: 'holiday',
        },
        {
          date: '2027-03-09',
          name: 'Idulfitri 1448 Hijriah',
          kind: 'cuti_bersama',
        },
        { date: '2027-03-10', name: 'Idulfitri 1448 Hijriah', kind: 'holiday' },
        { date: '2027-03-11', name: 'Idulfitri 1448 Hijriah', kind: 'holiday' },
        {
          date: '2027-03-12',
          name: 'Idulfitri 1448 Hijriah',
          kind: 'cuti_bersama',
        },
        {
          date: '2027-03-15',
          name: 'Idulfitri 1448 Hijriah',
          kind: 'cuti_bersama',
        },
        {
          date: '2027-03-25',
          name: 'Wafat Yesus Kristus',
          kind: 'cuti_bersama',
        },
        { date: '2027-03-26', name: 'Wafat Yesus Kristus', kind: 'holiday' },
        {
          date: '2027-03-28',
          name: 'Kebangkitan Yesus Kristus (Paskah)',
          kind: 'holiday',
        },
        {
          date: '2027-05-01',
          name: 'Hari Buruh Internasional',
          kind: 'holiday',
        },
        {
          date: '2027-05-06',
          name: 'Kenaikan Yesus Kristus',
          kind: 'holiday',
        },
        { date: '2027-05-17', name: 'Iduladha 1448 Hijriah', kind: 'holiday' },
        {
          date: '2027-05-18',
          name: 'Iduladha 1448 Hijriah',
          kind: 'cuti_bersama',
        },
        {
          date: '2027-05-19',
          name: 'Hari Raya Waisak 2571 BE',
          kind: 'cuti_bersama',
        },
        {
          date: '2027-05-20',
          name: 'Hari Raya Waisak 2571 BE',
          kind: 'holiday',
        },
        { date: '2027-06-01', name: 'Hari Lahir Pancasila', kind: 'holiday' },
        {
          date: '2027-06-06',
          name: 'Tahun Baru Islam 1449 Hijriah',
          kind: 'holiday',
        },
        {
          date: '2027-08-15',
          name: 'Maulid Nabi Muhammad SAW',
          kind: 'holiday',
        },
        {
          date: '2027-08-17',
          name: 'Proklamasi Kemerdekaan RI',
          kind: 'holiday',
        },
        {
          date: '2027-12-24',
          name: 'Kelahiran Yesus Kristus',
          kind: 'cuti_bersama',
        },
        {
          date: '2027-12-25',
          name: 'Kelahiran Yesus Kristus',
          kind: 'holiday',
        },
        {
          date: '2027-12-26',
          name: 'Isra Mikraj Nabi Muhammad SAW 1449 Hijriah',
          kind: 'holiday',
        },
      ],
    },
  },
} satisfies CalendarData;

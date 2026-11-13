# Dashboard Lexon di atas shadcn/ui

Desain dashboard memakai kerangka blok `sidebar-07` dari shadcn/ui (sidebar yang bisa diciutkan menjadi ikon, dengan pengalih tim di atas). Tidak ada komponen kerangka yang dibuat sendiri, jadi Anda cukup mengganti data dan tema.

## Memasang

Kalau bloknya belum ada di proyek Anda:

```
npx shadcn@latest add sidebar-07
```

Lalu tempel isi `lexon-shadcn-theme.css` ke `app/globals.css`, menggantikan blok `:root` bawaan.

## Padanan desain dan komponen

| Di desain | Komponen shadcn | Isi untuk Lexon |
|---|---|---|
| Kotak "WR", nama kantor, jumlah anggota | `TeamSwitcher` di `SidebarHeader` | Nama kantor hukum atau perusahaan, dan jumlah anggota atau nama paket |
| Grup "Alat" | `NavMain` | Assistant, Tabular Review, Editor. Alat yang sedang dibuka ditandai aktif dan menampilkan submenunya |
| Grup "Perkara" | `NavProjects` | Perkara terbaru, lalu "Lainnya" |
| Nama dan jabatan di bawah | `NavUser` di `SidebarFooter` | Nama pengguna. Baris kedua di blok aslinya berisi email; di desain diisi jabatan |
| Ikon panel, garis pemisah, jejak halaman | `SidebarTrigger`, `Separator`, `Breadcrumb` di dalam `SidebarInset` | Nama perkara, lalu nama alat atau dokumen |
| Tombol di kanan header | `Button variant="outline" size="sm"` | Bagikan, Unduh .docx |

## Teks menu

Bentuk datanya sama dengan `data` di `components/app-sidebar.tsx` bawaan blok. Yang diganti hanya isinya.

```ts
const data = {
  user: { name: "Rina Anggraini", email: "rina@kantor-anda.co.id", avatar: "/avatars/rina.jpg" },
  teams: [{ name: "Wiratama & Rekan", logo: Scale, plan: "12 anggota" }],
  navMain: [
    { title: "Assistant", url: "/assistant", icon: MessageSquare, isActive: true,
      items: [{ title: "Percakapan baru", url: "/assistant/baru" }, { title: "Riwayat", url: "/assistant/riwayat" }] },
    { title: "Tabular Review", url: "/tabular-review", icon: Table2,
      items: [{ title: "Telaah baru", url: "/tabular-review/baru" }, { title: "Semua telaah", url: "/tabular-review" }] },
    { title: "Editor", url: "/editor", icon: PenLine,
      items: [{ title: "Draf baru", url: "/editor/baru" }, { title: "Semua draf", url: "/editor" }] },
  ],
  projects: [
    { name: "Sewa PT Sinar Abadi", url: "/perkara/sewa-sinar-abadi", icon: Folder },
    { name: "Uji tuntas PT Kencana Raya", url: "/perkara/uji-tuntas-kencana-raya", icon: Folder },
    { name: "Sengketa merek Arunika", url: "/perkara/sengketa-merek-arunika", icon: Folder },
  ],
}
```

- Alamat (`url`) di atas hanya contoh. Sesuaikan dengan rute aplikasi Anda.
- Di desain, kotak logo pengalih tim berisi inisial kantor ("WR"). Di blok aslinya kotak itu berisi ikon; keduanya bisa dipakai.
- Di desain, baris kedua `NavUser` berisi jabatan. Di blok aslinya baris itu berisi email.
- Label grup: ganti "Platform" menjadi **Alat**, dan "Projects" menjadi **Perkara**.
- Item terakhir di daftar perkara: ganti "More" menjadi **Lainnya**.
- Semua nama orang, kantor, dan perkara di atas fiktif.

## Ukuran yang dipakai di desain

Semuanya nilai bawaan shadcn, tidak ada yang diubah.

| Bagian | Nilai |
|---|---|
| Lebar sidebar | 16rem (256 px) |
| Tinggi header | `h-16` (64 px) |
| Tombol menu | `h-8`, `text-sm`, ikon `size-4` |
| Tombol besar (pengalih tim, akun) | `h-12`, kotak logo dan avatar `size-8 rounded-lg` |
| Submenu | `h-7`, garis kiri 1 px |
| Ikon | Lucide, tebal garis 2 |

## Di mana merah muncul

Merah Segel hanya untuk tombol utama dan hal yang Lexon tandai untuk dicek.

| Komponen | Pemakaian merah |
|---|---|
| Tombol utama (`Button` bawaan) | Terima, Tambah kolom, Tandai sudah dicek, tombol kirim pertanyaan |
| Nomor rujukan | Latar Tint dengan angka merah. Yang sedang dibuka: latar merah, angka putih |
| Kutipan yang disorot | Latar Tint |
| Sel tabel yang berbeda dari yang lain | Latar `--lexon-flag`, teks merah, garis kiri 3 px |
| Lacak perubahan | Tambahan: merah bergaris bawah. Coretan: abu `--lexon-deleted` |
| Sakelar aktif, cincin fokus | Merah |

Sidebar sendiri tidak memakai merah. Item aktif memakai `--sidebar-accent`.

## File di folder ini

| File | Isi |
|---|---|
| `LEXON-dashboard-assistant.png` | Assistant: percakapan di tengah, dokumen sumber di kanan |
| `LEXON-dashboard-tabular-review.png` | Tabular Review: tabel dengan satu sel dibuka |
| `LEXON-dashboard-editor.png` | Editor: dokumen dengan lacak perubahan dan panel saran |
| `LEXON-dashboard-sidebar.png` | Sidebar saja, ukuran penuh |
| `LEXON-dashboard-komponen.png` | Lembar komponen dan variabel tema |
| `lexon-shadcn-theme.css` | Variabel tema untuk `globals.css` |

Semua layar berukuran 1440 x 900 px dan diekspor 2x.

## Yang belum ada

- Mode gelap.
- Tampilan sidebar saat diciutkan menjadi ikon, dan tampilan ponsel. Keduanya mengikuti perilaku bawaan `sidebar-07`.

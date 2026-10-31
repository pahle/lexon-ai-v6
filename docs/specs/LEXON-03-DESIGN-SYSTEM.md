---
version: "1.0"
name: Lexon
description: "Antarmuka terang yang tenang, datar, dan berorientasi kerja: teks hampir hitam, aksen ungu-abu redup, spasi 8px, tipografi system-ui."
inspiration: "Token awal diukur dari situs publik openai.com lalu dikoreksi untuk aksesibilitas. Lexon tidak memakai aset merek, logo, atau nama OpenAI."

colors:
  background: "#ffffff"
  surface: "#f7f7f8"
  surface-raised: "#ffffff"
  border: "#e5e5e9"
  text: "#0d0d0d"
  text-muted: "#6e6e80"
  primary: "#0d0d0d"
  on-primary: "#ffffff"
  accent: "#8e8ea0"
  accent-strong: "#5d5d6e"
  focus-ring: "#5d5d6e"
  danger: "#b42318"
  warning: "#8a5a00"
  success: "#1f7a3d"

typography:
  display: { fontFamily: "system-ui, sans-serif", fontSize: 48px, fontWeight: 700, lineHeight: 1.5 }
  heading: { fontFamily: "system-ui, sans-serif", fontSize: 32px, fontWeight: 600, lineHeight: 1.5 }
  body:    { fontFamily: "system-ui, sans-serif", fontSize: 16px, fontWeight: 400, lineHeight: 1.5 }
  mono:    { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }

spacing:
  base: 8px
  scale: [4, 8, 16, 24, 32, 40, 48, 64]

radius:
  sm: 5px

motion:
  duration: 400ms
  easing: "ease"
  reduced-motion: "patuhi prefers-reduced-motion (durasi menjadi 0ms)"

breakpoints: [768px]
---

# Lexon Design System

| Informasi | Detail |
|---|---|
| **Dokumen** | LEX-DS-001 |
| **Versi** | 1.0 |
| **Tanggal** | 31 Oktober 2026 |
| **Dokumen pendamping** | [Technology Stack](./LEXON-01-TECHNOLOGY-STACK.md) · [System Architecture](./LEXON-02-SYSTEM-ARCHITECTURE.md) |

## Rasional

Lexon adalah ruang kerja untuk membaca dan menyusun dokumen hukum dalam waktu lama. Antarmukanya menahan diri: dasar hampir hitam dan putih, satu aksen ungu-abu redup (`#8e8ea0`), font sistem, grid 8px, permukaan datar, dan satu radius 5px. Antarmuka harus terasa seperti alat kerja yang presisi, bukan aplikasi konsumen, dan tidak menarik perhatian saat pengacara membaca kontrak 60 halaman.

*Catatan bahasa:* nama token, nilai, dan teks antarmuka berbahasa Inggris (MVP berbahasa Inggris, Stack §1); dokumen ini berbahasa Indonesia.

## 1. Tema visual

- **Kesederhanaan yang diperhitungkan.** Tanpa bayangan dekoratif, gradien, atau ilustrasi. Pengelompokan memakai spasi, border 1px (`border`), dan pergeseran permukaan (`surface`).
- **Hanya mode terang pada MVP.** Token didefinisikan sebagai variabel CSS (konvensi shadcn/ui) sehingga tema gelap dapat ditambahkan kemudian tanpa mengubah komponen.
- **Desktop dan tablet terlebih dahulu** (≥ 768px). Di bawah 768px tata letak bertumpuk dan tetap dapat dipakai, tetapi tampilan padat (grid Tabular Review, editor DOCX) boleh menampilkan pemberitahuan "best on a larger screen".

## 2. Warna

| Token | Nilai | Pemakaian | Kontras pada `#ffffff` |
|---|---|---|---|
| `text` | `#0d0d0d` | Seluruh teks isi dan judul | 19,4:1 (AAA) |
| `text-muted` | `#6e6e80` | Teks sekunder, metadata, placeholder | 5,0:1 (AA) |
| `primary` / `on-primary` | `#0d0d0d` / `#ffffff` | Tombol utama, status terpilih | 19,4:1 |
| `accent` | `#8e8ea0` | Aksen merek: ikon, pemisah, indikator tidak aktif, tanda dekoratif. **Tidak pernah untuk teks.** | 3,2:1 (memenuhi 3:1 untuk UI non-teks, WCAG 1.4.11) |
| `accent-strong` | `#5d5d6e` | Tombol sekunder (teks putih), tautan saat hover, teks aksen bila diperlukan | 6,5:1 |
| `focus-ring` | `#5d5d6e` | Outline fokus 2px dengan offset 2px | 6,5:1 |
| `surface` | `#f7f7f8` | Sidebar, panel, header tabel | — |
| `border` | `#e5e5e9` | Pemisah, border input (input juga memerlukan penanda 3:1 saat fokus) | — |
| `danger` / `warning` / `success` | `#b42318` / `#8a5a00` / `#1f7a3d` | Teks dan ikon status; selalu disertai ikon atau label, tidak pernah hanya warna | ≥ 4,5:1 (juga pada `surface`) |

**Koreksi terhadap sumber ukur.** Palet hasil ukur memakai `#8e8ea0` untuk teks isi dan menyatakan kontras putih di atas `#8e8ea0` sekitar 8:1. Keduanya keliru untuk aksesibilitas: `#8e8ea0` di atas putih hanya 3,2:1 (gagal WCAG AA untuk teks), dan putih di atas `#8e8ea0` juga 3,2:1. Karena itu Lexon memakai hampir hitam untuk teks dan aksi utama, dan `#8e8ea0` hanya sebagai aksen non-teks. Berkas hasil ukur juga memberi label "text-muted" pada hitam pekat, yang terbalik; hal itu diperbaiki di atas.

**Warna domain** (didefinisikan saat fiturnya dibangun, dengan aturan yang sama): sitasi terverifikasi / tidak terverifikasi, tracked change sisip / hapus, status sel Tabular Review (`pending`, `running`, `done`, `error`, `stale`), dan OCR berkepercayaan rendah.

## 3. Tipografi

- `display` 48/700 — jarang; empty state dan judul onboarding.
- `heading` 32/600 — judul halaman. Judul bagian turun ke 24/600 dan 20/600 (tinggi baris kelipatan grid 8px).
- `body` 16/400, line-height 1,5 — bawaan untuk UI dan bacaan. UI padat (tabel, sidebar) boleh memakai 14/400.
- `mono` — kode, nomor klausul yang perlu sejajar, id.
- Seluruh font adalah font sistem; tidak ada web font yang dimuat.

## 4. Komponen

Dibangun dari shadcn/ui (style `base-nova`, primitives Base UI) dan registry assistant-ui, lalu disesuaikan melalui token di atas. Warna tidak di-hardcode di dalam komponen.

- **Tombol:** primary (isi `primary`), secondary (isi `accent-strong`, teks putih), ghost (teks saja, `surface` saat hover), destructive (`danger`). Tinggi minimum 40px; target sentuh ≥ 44×44px termasuk padding.
- **Input:** border 1px `border`, radius 5px, fokus menampilkan `focus-ring`.
- **Kartu dan panel:** datar, border 1px atau latar `surface`, tanpa bayangan. Overlay (dialog, menu, popover) boleh memakai satu bayangan halus untuk memisahkannya dari konten; hanya itu bayangan dalam sistem ini.
- **Chat:** pesan berupa blok bacaan selebar area, bukan gelembung, karena jawaban hukum panjang. Sitasi tampil sebagai penanda inline ringkas yang membuka sumbernya.
- **Gerak:** satu durasi (400ms, `ease`) untuk kemunculan dan transisi; umpan balik hover/tekan boleh instan. Patuhi `prefers-reduced-motion`.

## 5. Spasi dan tata letak

- Grid dasar 8px; 4px hanya untuk jarak inline rapat (ikon ke label).
- Kerangka aplikasi: sidebar kiri (navigasi, item terbaru), area konten utama, panel kanan opsional (penampil dokumen, sumber, detail).
- Satu breakpoint pada 768px.

## 6. Aksesibilitas (wajib, bukan saran)

- Standar minimum WCAG 2.2 AA: kontras teks ≥ 4,5:1, UI non-teks ≥ 3:1.
- Setiap elemen interaktif dapat dijangkau keyboard dengan cincin fokus yang terlihat.
- Tidak ada informasi yang disampaikan hanya melalui warna.
- Pemeriksaan otomatis (axe melalui Playwright) berjalan di CI pada halaman utama.

## 7. Riwayat perubahan

| Versi | Perubahan |
|---|---|
| 1.0 | Diadopsi dari berkas desain hasil ukur dengan koreksi: teks dan primary dipindah ke hampir hitam; `#8e8ea0` dibatasi sebagai aksen non-teks; label "text-muted" yang terbalik diperbaiki; ditambah token surface, border, fokus, dan status, font mono, skala spasi, reduced motion, serta AA sebagai kewajiban; komponen dipetakan ke shadcn/ui `base-nova` dan assistant-ui |

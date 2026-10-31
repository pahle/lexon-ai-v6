# LEXON
## Technology Stack Specification

| Informasi | Detail |
|---|---|
| **Dokumen** | LEX-TS-001 |
| **Versi** | 1.7 |
| **Status** | **LOCKED** — dengan prasyarat validasi (§9) |
| **Tanggal** | 31 Oktober 2026 |
| **Menggantikan** | v1.6 (31 Oktober 2026) |
| **Produk** | Lexon — Indonesian Legal AI Workspace |
| **Klasifikasi** | Internal · Product & Engineering |

## 1. Ringkasan

Lexon merupakan platform kerja berbantuan kecerdasan buatan untuk praktik hukum Indonesia. Platform dirancang untuk mendukung percakapan dan analisis hukum, peninjauan dokumen secara terstruktur, serta penyusunan dan penyuntingan dokumen dalam satu lingkungan kerja.

Spesifikasi ini mendefinisikan teknologi dasar yang digunakan untuk membangun dan mengoperasikan Lexon. Seluruh komponen yang tercantum membentuk **baseline teknologi v1.6** bagi pengembangan aplikasi, integrasi sistem, pengujian, dan deployment.

**Pola sistem:** frontend dan backend terpisah dalam satu pnpm workspace, dengan struktur folder root yang mengikuti Mike OSS: `backend/` (NestJS), `frontend/` (Next.js), dan `word-add-in/`. Backend adalah satu codebase modular; pemrosesan AI dan dokumen berjalan sebagai entrypoint terpisah dari codebase backend yang sama. Deployment awal menggunakan Linux VPS dan Docker Compose.

**Cakupan bahasa awal (MVP):** seluruhnya berbahasa **Inggris** — antarmuka aplikasi, pesan error, email transaksional, konten dan OCR dokumen, serta dokumentasi engineering turunan (brief, spec, dan plan superpowers). Dokumen acuan di `docs/specs/` tetap berbahasa Indonesia. Dukungan bahasa Indonesia disiapkan secara konfigurasi (lihat §4 dan §6) sehingga penambahannya tidak mengubah skema data; i18n antarmuka tidak dibangun di MVP, namun teks UI tidak di-hardcode tersebar agar dapat diekstraksi kemudian.

**Perubahan v1.7 terhadap v1.6:** (1) adaptor assistant-ui memakai `@assistant-ui/ai-sdk` (paket `@assistant-ui/react-ai-sdk` kini hanya re-export); (2) fondasi UI shadcn/ui memakai primitives **Base UI** (`@base-ui/react`, style `base-nova`) menggantikan Radix UI; (3) titik awal scaffold ditetapkan (§2); (4) bahasa MVP ditetapkan Inggris; (5) design system mengacu pada [Design System](./LEXON-03-DESIGN-SYSTEM.md).

**Perubahan v1.6 terhadap v1.5:** pencarian semantik berbasis vektor (`pgvector`, kolom `halfvec`, indeks HNSW, dan jalur embedding OpenRouter) dikeluarkan dari baseline MVP karena skala dokumen MVP tidak memerlukannya; retrieval memakai PostgreSQL FTS + `pg_trgm` dan jalur konteks penuh (Arsitektur §4.3). Penambahannya kembali memerlukan keputusan stack yang eksplisit.

**Perubahan utama v1.5 terhadap v1.4:** (1) item yang sebelumnya "ditentukan nanti" ditetapkan: adaptor Better Auth, TypeScript 6.x, Zod 4.x, PostgreSQL 17.x, logging/konfigurasi/health, lapisan data frontend, alat uji beban dan rantai pasok, pin image, jalur error browser, dan runner evaluasi; (2) koreksi: toolchain backend memakai `tsc` (bukan Webpack), Valkey 9.0.x, klien MCP v2, `proxy.ts` pada Next.js 16, dan policy RLS dengan `NULLIF`; (3) catatan lisensi dan risiko baru (Mike OSS AGPL-3.0, ExcelJS, EigenPal Pro); (4) tabel baseline versi (§7). Daftar lengkap ada di §11. Keputusan bisnis dan legal (penyedia dan wilayah infrastruktur, bahasa MVP, model chat, angka retensi dan RPO/RTO) tetap terbuka dan dicatat pada Arsitektur §9.

## 2. Application Platform

| Area | Teknologi | Peran |
|---|---|---|
| Architecture | Modular Backend (NestJS) + Frontend terpisah + Dedicated Workers | Frontend dan backend terpisah pada batas deploy dan kepercayaan; modul bisnis berada di backend; workers adalah entrypoint dari codebase backend |
| Source repository | Monorepo · pnpm Workspaces (`backend/`, `frontend/`, `word-add-in/`, `shared/`, `evals/`) | Struktur root mengikuti Mike OSS; `shared/` adalah satu-satunya paket bersama (kontrak) |
| Implementation languages | TypeScript 6.x (strict; versi di-pin; satu versi untuk seluruh workspace), JavaScript, SQL | Bahasa aplikasi, integrasi, dan query data. Templat assistant-ui memakai TypeScript 7 dan diturunkan ke 6.x saat scaffold: NestJS 12 (CLI memakai `~6.0`), metadata dekorator, Vitest, dan Stryker belum diverifikasi pada TS 7 |
| Module format | ESM-only (`"type": "module"` di seluruh paket) | Dipersyaratkan oleh AI SDK 7; Better Auth pada server Node juga hanya mendukung ESM. Backend memakai mode proyek ESM NestJS 12 dan dikompilasi dengan `tsc` (`nest build`); konfigurasi TypeScript dan Vitest disesuaikan. Webpack hanya dipakai pada `word-add-in/` |
| Frontend framework | Next.js 16 | App Router dan Server Components untuk UI dan SSR. Tanpa akses database dan tanpa logika bisnis; Route Handlers dan Server Actions tidak dipakai untuk logika bisnis; `proxy.ts` (pengganti `middleware.ts` pada Next.js 16, runtime Node.js) hanya untuk pengalihan cepat berdasarkan keberadaan cookie sesi (Arsitektur §3.5) |
| Backend framework | NestJS 12 (adaptor Express; proyek ESM) | HTTP API, SSE, modul domain, guard autentikasi dan otorisasi, serta entrypoint worker |
| UI runtime | React 19 | Komposisi antarmuka dan interaksi klien |
| Server runtime | Node.js 24 LTS | Eksekusi backend, workers, dan server Next.js |
| Scaffold awal | Frontend: templat `default` assistant-ui (`npx assistant-ui@latest create`), lalu disesuaikan ke baseline ini (TypeScript 6.x, ESLint + Prettier, `@assistant-ui/ai-sdk`). Backend: `nest new` (NestJS 12, mode proyek ESM) dengan pola streaming dari cookbook AI SDK untuk Nest.js (`pipeUIMessageStreamToResponse`) | Templat hanya titik awal: pada arsitektur Lexon generation berjalan di AI Worker dan dikirim melalui Valkey Streams → SSE (Arsitektur §4.1), bukan langsung dari controller |
| Package management | pnpm (versi dependensi di-pin eksak; `pnpm.overrides` untuk paket yang harus tunggal) | Instalasi dan resolusi dependensi |
| Input validation | Zod 4.x (satu versi untuk seluruh workspace melalui `pnpm.overrides`; skema di `shared/`; dipakai langsung pada decorator route NestJS melalui dukungan Standard Schema) | Validasi data pada batas sistem; kontrak yang sama dipakai frontend, backend, dan add-in (diverifikasi pada S6) |

## 3. User Interface & Document Experience

| Area | Teknologi | Peran |
|---|---|---|
| Styling | Tailwind CSS 4 | Utility styles, responsivitas, dan design tokens |
| UI foundation | shadcn/ui (style `base-nova`) + Base UI (`@base-ui/react`) | Komponen dan primitives antarmuka. Base UI dipilih karena menjadi default templat dan registry komponen assistant-ui (komponen chat tidak perlu ditulis ulang), dipelihara aktif, dan didukung penuh shadcn/ui. Radix UI tidak dipakai; satu pustaka primitives untuk seluruh `frontend/` |
| Iconography | Lucide | Sistem ikon aplikasi |
| AI chat interface | assistant-ui (`@assistant-ui/react` + `@assistant-ui/ai-sdk`, jalur `ai@^7` + `@ai-sdk/react@^4`; komponen dari registry `@assistant-ui` style `base-nova`) | Primitives percakapan, streaming, reasoning, dan rendering (di `frontend/`). `@assistant-ui/react-ai-sdk` hanya re-export dari `@assistant-ui/ai-sdk` dan tidak dipakai |
| Rich-text editing (non-DOCX) | Tiptap 3 + ProseMirror | **Dibatasi** pada konten non-DOCX: instruksi project, composer dengan mention, catatan, dan pratinjau draf AI. Dokumen hukum tidak disunting di Tiptap |
| DOCX editing — Core | EigenPal DOCX Editor: `@docx-editor.dev/core` + `@docx-editor.dev/react` (Apache-2.0) | Membuka, menyunting, dan menyimpan DOCX dengan OOXML kanonik, di browser (`frontend/`) |
| DOCX editing — Review | `@docx-editor.dev/pro` (lisensi komersial EigenPal Pro) | Tracked changes dan komentar. **Wajib berlisensi sebelum penggunaan produksi** (§9, §10) |
| DOCX automation (opsional) | `@docx-editor.dev/editor-api` (EigenPal Pro) | Otomasi dokumen di browser/server; dipakai di backend untuk membuat OOXML beratribusi bagi Word add-in dan bila hasil spike S1 memerlukannya |
| Editor abstraction | `EditorPort` (antarmuka di `shared/`; adaptor di `frontend/` dan `backend/`) | Antarmuka internal (open, save, applySuggestions, listChanges, export) agar EigenPal dapat diganti tanpa mengubah domain |
| PDF experience | PDF.js | Rendering, navigasi, seleksi teks, dan penyorotan sumber sitasi |
| Tabular review interface | TanStack Table + TanStack Virtual (pola shadcn/ui data table) | Grid dokumen × kolom dengan virtualisasi, status sel, dan sitasi per sel |
| Data fetching (frontend) | TanStack Query (versi di-pin) | Cache, retry, dan sinkronisasi klien API bertipe (`shared/`) di `frontend/` |
| Forms (frontend) | React Hook Form + Zod resolver | Formulir dengan skema Zod dari `shared/` yang sama dengan validasi backend |
| Spreadsheet processing | ExcelJS 4.4.0 (di-pin; satu-satunya pustaka XLSX) | Impor workbook sebagai input dan ekspor hasil review; hanya dijalankan di Document Worker (tanpa internet) karena pustaka tidak aktif dipelihara (§10) |
| Microsoft Word add-in | Office.js + React + Webpack (folder `word-add-in/`, bundel statis) | Integrasi pengalaman Lexon dalam Microsoft Word; autentikasi berbasis token (§4) |

*Catatan paket EigenPal:* paket lama `@eigenpal/*` (seri 1.x) tidak digunakan. Baseline memakai `@docx-editor.dev/*` (seri 2.x).

## 4. Identity, Authorization & Data

| Area | Teknologi | Peran |
|---|---|---|
| Authentication | Better Auth (plugin: Organization, Admin, Two-Factor, Bearer), dipasang di backend NestJS pada `/api/auth/*` melalui adaptor NestJS (adaptor: pustaka komunitas `@thallesp/nestjs-better-auth`; adaptor internal tipis di atas `toNodeHandler` hanya bila S6 menunjukkan ketidakcocokan dengan NestJS 12 atau ESM) | Identitas, sesi, organisasi, 2FA, dan token untuk klien non-cookie (Word add-in); frontend memakai klien `better-auth/react` pada origin yang sama; tabel Better Auth berada di skema `auth` dengan role database tersendiri (Arsitektur §3.2) |
| Transactional email | SMTP melalui Nodemailer (penyedia ditetapkan saat deployment) | Verifikasi akun, undangan organisasi, notifikasi keamanan |
| Authorization | Lexon RBAC + resource-level policies (guard dan policy services NestJS) | Kontrol akses organisasi, workspace, project, dan konten |
| Tenant isolation | PostgreSQL Row-Level Security (RLS) | Lapis pertahanan kedua isolasi antar-organisasi di bawah policies aplikasi; konteks ditetapkan melalui wrapper `withTenant` (`set_config` lokal-transaksi) dan bersifat fail-closed; policy memakai `NULLIF(current_setting('app.org_id', true), '')::uuid` agar koneksi pool bekas pakai tidak melempar error cast |
| Primary database | PostgreSQL 17.x (minor di-pin) | Penyimpanan transaksional dan sumber data bisnis utama |
| Database extensions | `pg_trgm` | Pencarian trigram untuk nomor pasal, pola sitasi, dan pencocokan teks tidak persis |
| ORM | Drizzle ORM (hanya di `backend/`) | Model relasional dan typed database access |
| Database connection | node-postgres (`pg`) (hanya di `backend/`) | Driver PostgreSQL dan connection pooling |
| Schema management | Drizzle Kit + versioned SQL migrations di `backend/drizzle/` (termasuk definisi RLS dan role) | Evolusi skema terkontrol |
| Data access | Drizzle + parameterized SQL + PostgreSQL functions | Query aplikasi dan operasi database terstruktur |
| Keyword search | PostgreSQL Full-Text Search (konfigurasi bahasa per chunk) + `pg_trgm` | Pencarian teks, percakapan, metadata, dan pola sitasi |
| Retrieval (fusi RRF) | Fusi peringkat (Reciprocal Rank Fusion) di SQL, dibangun di domain Knowledge & Retrieval | Menggabungkan hasil FTS dan trigram dengan filter otorisasi terpusat; konteks penuh untuk dokumen tunggal |
| Konfigurasi bahasa FTS | v1: `english`. Berikutnya: `indonesian` (stemmer Snowball bawaan PostgreSQL) + dictionary sinonim singkatan hukum | Penambahan bahasa Indonesia berupa perubahan konfigurasi dan re-index, bukan perubahan skema |

## 5. AI & Asynchronous Processing

| Area | Teknologi | Peran |
|---|---|---|
| AI SDK | Vercel AI SDK 7 (ESM-only) | Streaming model, structured output, dan tool execution |
| AI provider integration | `@openrouter/ai-sdk-provider` (seri 3.x, target `ai@^7`) | Integrasi model melalui AI SDK |
| AI inference gateway | OpenRouter (preferensi provider dikirim eksplisit per request) | Akses model AI dengan kebijakan routing retensi nol dan allowlist model/provider terverifikasi (Arsitektur §6.2) |
| Model Context Protocol | MCP · `@modelcontextprotocol/client` v2 (spec 2026-07-28; peer dependency Zod 4) | Protokol dan SDK klien integrasi AI dengan tool dari layanan eksternal; diuji terhadap server berspec lama |
| MCP transport | Streamable HTTP | Koneksi server MCP jarak jauh |
| MCP connector authentication | OAuth 2.0 (validasi issuer metadata ketat, RFC 8414), bearer token, dan custom headers | Otorisasi koneksi eksternal yang dikelola pengguna |
| MCP tool integration | Connector management, tool discovery, dan tool policies | Pemilihan serta pengendalian tool yang tersedia untuk AI |
| AI execution | Dedicated Node.js AI Worker — entrypoint tersendiri dari codebase `backend/`, dijalankan sebagai container terpisah | Eksekusi generation dan pekerjaan AI |
| Background jobs | BullMQ 6 (integrasi NestJS melalui `@nestjs/bullmq`; kompatibilitas dengan BullMQ 6 dan NestJS 12 diverifikasi pada S6, cadangan: pembungkus provider NestJS tipis di atas `Queue`/`Worker` BullMQ) | Antrean, scheduling, concurrency, dan retry |
| Queue infrastructure | Valkey 9.0.x, patch ≥ 9.0.6 dan di-pin (`maxmemory-policy noeviction`, AOF `everysec`, autentikasi, jaringan internal, anggaran memori per penggunaan) | Penyimpanan operasional antrean, event, dan rate limiting; koneksi dikonfigurasi terpisah per penggunaan agar dapat dipisah ke instance lain (Arsitektur §5.4) |
| Durable work coordination | PostgreSQL + Transactional Outbox + Outbox Dispatcher (entrypoint tersendiri dari `backend/`, satu instance aktif melalui advisory lock) | Pencatatan pekerjaan, konsistensi, dan pemulihan pengiriman |
| Streaming delivery | Server-Sent Events (SSE) + Valkey Streams (dengan `MAXLEN` dan TTL per run) + stream hub per proses Backend API | Pengiriman event real-time ke klien dengan dukungan resume; jumlah koneksi Valkey tetap per proses, tidak bertambah per klien (Arsitektur §4.1) |
| Rate limiting & quota | Limiter berbasis Valkey (`rate-limiter-flexible`) + pencatatan `usage_events` di PostgreSQL | Pembatasan laju, kuota per organisasi, dan metering biaya |
| AI telemetry | `@ai-sdk/otel` → OpenTelemetry | Tracing generation dan tool; isi prompt tidak direkam secara default |
| Evaluation | Harness evaluasi berbasis Vitest (`evals/`), dijalankan pada application context NestJS standalone (tanpa HTTP) ditambah sejumlah kecil skenario end-to-end melalui API publik | Pengujian kualitas jawaban, akurasi sitasi, dan ketahanan terhadap prompt injection |

## 6. Document Processing & Storage

| Area | Teknologi | Peran |
|---|---|---|
| Document execution | Dedicated Node.js Document Worker — entrypoint dari codebase `backend/`, container tanpa akses internet | Pipeline pemindaian, ekstraksi, OCR, chunking, dan konversi |
| Object storage | **SeaweedFS** seri 4.x (tag eksak di-pin saat S5 dimulai; S3 gateway; Apache-2.0) | Penyimpanan objek berbasis S3-compatible API; menggantikan RustFS |
| Storage contract | Antarmuka S3 + contract test di CI | Batas yang dapat ditukar (SeaweedFS, Garage, RustFS, atau S3 terkelola) tanpa mengubah aplikasi |
| Storage client | AWS SDK for JavaScript v3 | Akses penyimpanan, presigned uploads, dan lifecycle objek |
| Object encryption | Node.js `crypto`: AES-256-GCM tersegmentasi dengan DEK per organisasi (envelope encryption) | Enkripsi level aplikasi atas konten klien di penyimpanan objek; mendukung baca `Range` dan crypto-shredding (Arsitektur §5.6) |
| Upload scanning | ClamAV (`clamd`, layanan terpisah) | Pemindaian malware sebelum dokumen diproses |
| OCR | OCRmyPDF + Tesseract (v1: bahasa `eng`; berikutnya `eng+ind`) | Mengubah PDF/gambar hasil scan menjadi PDF dengan text layer |
| Office conversion | LibreOffice Headless dalam container sandbox terpisah | Konversi format dokumen Office dengan isolasi |
| Document text extraction | Mammoth + PDF.js (build legacy untuk Node) | Ekstraksi isi DOCX dan PDF (termasuk posisi teks untuk sitasi) |
| DOCX generation | `docx` | Pembuatan dokumen Word terprogram |

## 7. Operations, Quality & Delivery

| Area | Teknologi | Peran |
|---|---|---|
| Reverse proxy & HTTPS | Caddy (buffering respons SSE dinonaktifkan) | Terminasi TLS dan routing: `/api/*` ke backend, selainnya ke frontend; menyajikan bundel statis add-in pada domain tersendiri |
| Containerization | Docker + Docker Compose (batas memori/CPU per layanan; seluruh image di-pin dengan tag eksak dan digest, tidak pernah `latest`) | Packaging, isolasi, dan orkestrasi layanan awal; image `frontend`, `backend` (target `api`, `ai-worker`, `dispatcher`), dan `document-worker` (target backend dengan toolchain OCR) |
| Hosting | Linux VPS (disk terenkripsi LUKS; profil awal produksi minimum 8 vCPU, 32 GB RAM, NVMe) | Infrastruktur aplikasi dan data; profil dikalibrasi melalui uji beban (Arsitektur §5.3) |
| Secrets | Docker secrets / file secret berizin ketat | Penyimpanan kredensial dan key-encryption-key di luar repositori dan database |
| Backup | pgBackRest (full + WAL archiving, terenkripsi) + replikasi objek terjadwal ke penyimpanan off-site (`rclone sync`, terenkripsi, mempropagasikan penghapusan), dengan jendela retensi W | Pemulihan point-in-time dan pemulihan objek; ledger penghapusan diputar ulang setelah restore (Arsitektur §6.3) |
| Error monitoring | Sentry (scrubbing sebelum dikirim) + Sentry Relay internal | Pelacakan error aplikasi tanpa konten dokumen; runtime tanpa egress (Document Worker) mengirim melalui Relay; error sisi browser dikirim melalui `tunnel` Sentry pada endpoint Backend API (Arsitektur §2.2) |
| Observability | OpenTelemetry + OpenTelemetry Collector (layanan internal) | Tracing dan metrics lintas runtime; Collector menjadi satu-satunya jalur ekspor telemetri dan lapis kedua penghapusan atribut sensitif |
| Logging | pino (`nestjs-pino`) dengan daftar redaksi bawaan | Log terstruktur tanpa isi dokumen atau prompt (Arsitektur §6.2) |
| Configuration & health | `@nestjs/config` dengan skema Zod (Standard Schema); `@nestjs/terminus` | Validasi variabel lingkungan saat boot dan health check tiap runtime backend |
| Unit & integration tests | Vitest + `@nestjs/testing`; endpoint backend diuji melalui HTTP ke port efemeral memakai `fetch` (Supertest tetap tidak dipakai) | Verifikasi modul dan antarmuka HTTP; transformer dekorator mengikuti templat resmi NestJS 12 dan diverifikasi bersama Stryker pada S6 |
| End-to-end & API tests | Playwright (termasuk `APIRequestContext`) | Verifikasi workflow melalui browser dan HTTP |
| Mutation tests | Stryker | Evaluasi kekuatan assertion pada test suite |
| Load testing | k6 | Uji beban SSE (S2: ≥ 500 koneksi), Tabular Review (S4), dan kalibrasi profil sumber daya (Arsitektur §5.3) |
| Code quality | ESLint + Prettier + TypeScript strict; aturan batas modul (impor lintas modul, driver database, gateway model) | Pemeriksaan kualitas dan konsistensi kode. Templat `nest new` dan assistant-ui memakai oxlint/oxfmt; Lexon tetap memakai ESLint + Prettier karena aturan batas modul dan folder (Arsitektur §3.4) memerlukan ekosistem plugin ESLint (`no-restricted-imports`, aturan boundaries) |
| CI/CD | GitHub Actions (job per folder workspace dengan filter `pnpm --filter`) | Otomasi verifikasi, build, dan delivery |
| Software supply chain | Syft (SBOM format CycloneDX) + Trivy (image, dependensi, lisensi) + OSV-Scanner (lockfile) + Renovate | Inventaris, pemantauan, dan pembaruan dependensi terkelola; kebijakan lisensi berupa daftar izin (MIT, Apache-2.0, BSD, ISC), AGPL/GPL hanya sebagai layanan terpisah |

*Kebijakan versi:* dependensi di-pin eksak dengan lockfile. Pembaruan dilakukan terjadwal melalui Renovate; pembaruan AI SDK, provider, dan model wajib lolos subset evaluasi (`evals/`) sebelum digabung.

**Baseline versi (v1.7).** Patch eksak di-pin saat scaffold dan dinaikkan Renovate.

| Komponen | Baseline | Catatan |
|---|---|---|
| Node.js | 24 LTS | AI SDK 7 diuji pada Node 24; NestJS 12 mensyaratkan Node 20.19+ atau 22.12+ |
| TypeScript | 6.x | TS 7 (native) hanya dievaluasi untuk typecheck CI |
| NestJS | 12.x (adaptor Express, proyek ESM) | Kompatibilitas pustaka integrasi diverifikasi pada S6 |
| Next.js dan React | Next.js 16.x, React 19 | `proxy.ts` menggantikan `middleware.ts` |
| assistant-ui | `@assistant-ui/react` 0.15.x, `@assistant-ui/ai-sdk` | Komponen dari registry style `base-nova` |
| UI primitives | `@base-ui/react` 1.x, shadcn/ui CLI | Tanpa Radix UI |
| AI SDK | `ai@^7`, `@ai-sdk/react@^4`, `@ai-sdk/otel` | Node ≥ 22, ESM-only |
| Provider OpenRouter | `@openrouter/ai-sdk-provider` 3.x | Dipakai AI Worker untuk generation |
| Antrean | BullMQ 6.x dengan `@nestjs/bullmq` | Diverifikasi pada S6 |
| Valkey | 9.0.x (≥ 9.0.6) | Konfigurasi `noeviction` dan AOF tidak berubah |
| PostgreSQL | PostgreSQL 17.x (ekstensi: `pg_trgm`) | Pindah versi mayor dijadwalkan terpisah |
| Zod | 4.x | Dibutuhkan MCP SDK v2 dan Standard Schema |
| MCP | `@modelcontextprotocol/client` v2 | Spec 2026-07-28; diuji terhadap server berspec lama |
| Better Auth | 1.x dengan `@thallesp/nestjs-better-auth` | Diverifikasi pada S6 |
| Logging dan health | `nestjs-pino`, `@nestjs/terminus` | Diverifikasi pada S6 |
| Spreadsheet | ExcelJS 4.4.0 | Risiko pemeliharaan, lihat §10 |
| Penyimpanan objek | SeaweedFS 4.x | Tag eksak ditetapkan saat S5 |

## 8. Prinsip Integrasi

1. **Satu sumber kontrak:** frontend, backend, worker, dan add-in memakai skema Zod dan kontrak event yang sama dari `shared/`; logika domain hanya berada di backend.
2. **Tanggung jawab terpisah:** frontend melayani UI dan SSR; Backend API melayani interaksi pengguna dan seluruh akses data; AI Worker mengeksekusi tugas AI; Document Worker menangani pemrosesan dokumen. Worker dan dispatcher adalah entrypoint dari codebase backend, masing-masing dengan root module yang hanya memuat modul yang dibutuhkan.
3. **Data bisnis terpusat:** PostgreSQL menyimpan identitas resource, metadata, akses, chunk, dan status proses; penyimpanan objek S3 menyimpan file.
4. **Batas S3 sebagai kontrak:** aplikasi hanya bergantung pada API S3 dan diuji dengan contract test, sehingga implementasi penyimpanan dapat diganti.
5. **DOCX adalah format kanonik dokumen hukum:** tracked changes dan komentar berada di dalam OOXML sehingga dokumen tetap valid di Microsoft Word tanpa bergantung pada editor tertentu.
6. **Operasi asinkron terkelola:** BullMQ, Valkey, dan PostgreSQL digunakan sesuai perannya dalam antrean, pengiriman event, serta ketahanan pekerjaan.
7. **Integrasi tool terkendali:** MCP menyediakan koneksi ke layanan eksternal melalui connector yang memiliki autentikasi, batas akses, kebijakan tool, dan persetujuan operasi yang memodifikasi data.
8. **Konten tidak tepercaya diisolasi:** file unggahan diproses dalam batas yang terkendali (pemindaian, sandbox, batas sumber daya); isi dokumen dan hasil tool diperlakukan sebagai data, bukan instruksi.
9. **Kerahasiaan sebagai batasan desain:** pengiriman data ke model, logging, retensi, dan penghapusan mengikuti kontrol pada Arsitektur §6.
10. **Komponen UI konsisten:** pengalaman pengguna dibangun di atas fondasi antarmuka dan editor yang telah ditetapkan.
11. **Integrasi terukur:** kontrak antar-runtime, kontrol akses, isolasi tenant, kualitas jawaban, dan perubahan data diuji sesuai kebutuhan setiap workflow.
12. **Frontend tanpa akses data:** frontend tidak memiliki koneksi ke PostgreSQL, Valkey, atau penyimpanan objek dan tidak memegang rahasia server; seluruh akses data melalui API backend pada origin yang sama.

## 9. Prasyarat Validasi Sebelum Penggunaan Produksi

Baseline ini berstatus LOCKED untuk pengembangan. Item berikut harus selesai sebelum fitur terkait dianggap siap produksi. Perincian kriteria spike ada pada [System Architecture §10](./LEXON-02-SYSTEM-ARCHITECTURE.md).

| # | Prasyarat | Alasan |
|---|---|---|
| P1 | **Lisensi EigenPal Pro aktif** sebelum penggunaan produksi, pilot pelanggan, atau POC berbayar; konfirmasi bahwa satu langganan mencakup pemakaian paket `@docx-editor.dev/*` di `frontend/`, `backend/` (`editor-api`), dan `word-add-in/` sebagai satu produk (hubungi `licensing@eigenpal.com`); verifikasi bahwa paket Pro (termasuk `telemetry` bila dipakai) tidak mengirim konten dokumen ke luar dari runtime yang memiliki egress; minta klausul keberlangsungan (akses sumber bila vendor berhenti) | Lisensi evaluasi pada repositori hanya mengizinkan penggunaan non-produksi (§10) |
| P2 | Spike S1 — fidelitas DOCX dan tracked changes lintas Microsoft Word, termasuk pembuatan OOXML beratribusi di backend dan penyisipannya dari Word add-in | Inti pengalaman drafting dan redlining |
| P3 | Spike S2 — kontrak streaming worker → Valkey → SSE → assistant-ui, termasuk resume, cancel, penutupan graceful saat deploy, dan uji beban stream hub pada Backend API | Menentukan model persistensi message dan kapasitas koneksi |
| P4 | Spike S3 — pipeline OCR + retrieval keyword (FTS + trigram) dengan sitasi terverifikasi, termasuk kualitas retrieval (Recall@K, MRR) dan rencana query dengan RLS aktif | Fondasi grounding |
| P5 | Spike S4 — Tabular Review skala 50 dokumen × 20 kolom | Validasi grid, penjadwalan job, dan akurasi estimasi biaya |
| P6 | Spike S5 — contract test S3 pada SeaweedFS, termasuk presigned upload, multipart, lifecycle, dan latihan restore | Pemilihan penyimpanan dinyatakan valid hanya setelah teruji |
| P7 | Konsultasi hukum atas kerahasiaan dan kepatuhan (Arsitektur §6.4) | Produk memproses dokumen klien dan data pribadi |
| P8 | Verifikasi bahwa setiap model dalam allowlist memiliki endpoint yang memenuhi kebijakan retensi nol, beserta wilayah pemrosesan provider-nya | Prasyarat pengiriman konten klien ke model (Arsitektur §6.2, §6.4) |
| P9 | Spike S6 — fondasi backend NestJS 12: proyek ESM dengan AI SDK 7, verifikasi adaptor Better Auth (`@thallesp/nestjs-better-auth`), validasi Zod 4 melalui Standard Schema, `withTenant` dan RLS dari controller dan processor, entrypoint worker, `@nestjs/bullmq` dengan BullMQ 6 pada Valkey 9.0.x, `nestjs-pino` dan `@nestjs/terminus`, klien MCP v2, serta Vitest dan Stryker | NestJS 12 dan komponen integrasinya baru; kompatibilitasnya dengan komponen baseline lain belum teruji pada proyek ini |

## 10. Catatan Lisensi Komponen Penting

Dibaca dari sumber resmi pada 21 Oktober 2026; verifikasi ulang saat pengadaan. Baris NestJS ditambahkan pada 28 Oktober 2026 berdasarkan pemberitaan rilis NestJS 12 dan juga perlu diverifikasi ulang saat pengadaan. Baris Mike OSS dan catatan ExcelJS ditambahkan pada 29 Oktober 2026 dari hasil review dan juga perlu diverifikasi ulang saat pengadaan. Bagian ini bukan nasihat hukum.

| Komponen | Lisensi | Catatan untuk Lexon |
|---|---|---|
| EigenPal Core + React | Apache-2.0 | Gratis, termasuk untuk produk komersial |
| EigenPal Pro (`pro`, `editor-api`, `docx-to-pdf`, `telemetry`) | Komersial; **repositori memuat "Evaluation License"** | Evaluasi **non-produksi** gratis. "Production Use" mencakup lingkungan live, pemrosesan data pelanggan atau operasional, pilot pelanggan, POC berbayar, dan operasional bisnis internal rutin. Penggunaan produksi memerlukan perjanjian komersial. Paket dapat terpasang di tiga folder (`frontend/`, `backend/`, `word-add-in/`); cakupan "satu produk" dikonfirmasi pada P1 |
| Skema harga EigenPal Pro | US$500 per bulan **per produk**; Enterprise adalah perangkat lunak yang sama ditambah dukungan langsung | Perpanjangan otomatis bulanan; biaya renewal dapat disesuaikan dengan pemberitahuan 30 hari; EigenPal dapat mengubah syarat dengan pemberitahuan 30 hari; tanpa dukungan pada tier Pro; bila berhenti, paket Pro wajib dihapus dari produk |
| Modifikasi pada paket Pro | Modifikasi yang diungkapkan ke EigenPal atau pihak ketiga (termasuk saat meminta dukungan) otomatis berlisensi Apache-2.0 | Jangan melampirkan kode internal ke tiket dukungan tanpa tinjauan |
| NestJS | MIT | Dipakai sebagai framework backend |
| Mike OSS (acuan struktur) | AGPL-3.0 | Hanya struktur folder yang diacu; tidak ada kode Mike OSS (termasuk `word-addin/` dan workflow-nya) yang disalin ke Lexon. Menyalin kode mewajibkan Lexon mematuhi AGPL-3.0 |
| ExcelJS | MIT | Versi 4.4.0 tidak dirilis ulang lebih dari setahun dan dinilai tidak aktif dipelihara. Mitigasi: dijalankan hanya di Document Worker tanpa internet, dengan batas rasio kompresi dan ukuran terurai, dan versi di-pin; fork pihak ketiga hanya dievaluasi, bukan default |
| SeaweedFS | Apache-2.0 | Dijalankan sebagai layanan terpisah |
| Garage | AGPL-3.0 | Tidak dipilih sebagai default; tetap kandidat pengganti bila kontrak S3 lolos uji |
| ClamAV | GPL-2.0 | Dijalankan sebagai layanan terpisah, tidak ditautkan ke kode aplikasi |
| OCRmyPDF / Tesseract / LibreOffice | MPL-2.0 / Apache-2.0 / MPL-2.0 | Dijalankan sebagai proses atau layanan terpisah |

**Mitigasi ketergantungan EigenPal:** (a) `EditorPort` mengisolasi editor dari domain; (b) tracked changes tersimpan di OOXML sehingga dokumen tetap terbaca di Word jika editor diganti; (c) biaya langganan tercatat sebagai biaya operasional tetap; (d) pantau perubahan syarat melalui kontak lisensi; (e) minta klausul keberlangsungan (akses sumber bila vendor berhenti), karena menurut arsip pihak ketiga (belum diverifikasi) repositori dan situs vendor sempat tidak dapat diakses pada Juni 2026.

## 11. Kendali Dokumen dan Riwayat Perubahan

Dokumen ini merupakan **sumber acuan teknologi yang telah disetujui**. Penetapan struktur modul, API, alur data, dan deployment dijelaskan dalam dokumen pendamping [System Architecture](./LEXON-02-SYSTEM-ARCHITECTURE.md); bahasa visual dan design tokens dalam [Design System](./LEXON-03-DESIGN-SYSTEM.md).

Perubahan terhadap pilihan teknologi pada versi ini memerlukan keputusan produk dan engineering yang eksplisit. Pembaruan kompatibilitas, keamanan, dan dependensi dievaluasi terhadap baseline tersebut.

| Versi | Perubahan |
|---|---|
| 1.1 | Baseline awal |
| 1.2 | **Diganti:** FortuneSheet + LuckyExcel → TanStack Table + TanStack Virtual; RustFS → SeaweedFS di balik kontrak S3; SheetJS dihapus, ExcelJS menjadi satu-satunya pustaka XLSX; Supertest dihapus, Route Handler diuji langsung. **Ditambah:** `pgvector` dan hybrid retrieval; OCRmyPDF + Tesseract; ClamAV; LibreOffice sandbox; PostgreSQL RLS; plugin Better Auth Two-Factor dan Bearer; Nodemailer; rate limiting dan metering; harness evaluasi; `@ai-sdk/otel`; pgBackRest dan replikasi off-site; Docker secrets; Renovate dan kebijakan pin versi. **Diperjelas:** skema lisensi EigenPal (Core vs Pro) dan nama paket `@docx-editor.dev/*`; peran Tiptap dibatasi pada konten non-DOCX; format ESM-only; konfigurasi Valkey (`noeviction`, AOF, MAXLEN/TTL); `EditorPort`; konfigurasi bahasa FTS (Inggris dahulu, Indonesia disiapkan) |
| 1.3 | **Ditambah:** strategi pencarian vektor dua jalur dan `pgvector` ≥ 0.8; stream hub SSE; Outbox Dispatcher sebagai proses tersendiri; enkripsi objek per organisasi (`crypto`, AES-256-GCM tersegmentasi); OpenTelemetry Collector dan Sentry Relay; profil sumber daya VPS awal; prasyarat P8 (verifikasi model terhadap kebijakan retensi). **Diperjelas:** skema `auth` dan role database untuk Better Auth; wrapper `withTenant` yang fail-closed; anggaran memori Valkey dan koneksi per penggunaan; replikasi objek dengan propagasi penghapusan, jendela retensi W, dan ledger penghapusan; kriteria P2–P5 |
| 1.4 | **Diganti:** Next.js "Web & API" → Next.js 16 sebagai frontend saja + **NestJS 12** sebagai backend (adaptor Express, proyek ESM); struktur `apps/*` dan `packages/*` → struktur root `backend/`, `frontend/`, `word-add-in/`, `shared/`, `evals/`, `infra/`, `docs/` yang mengikuti Mike OSS; pengujian Route Handler langsung → `@nestjs/testing` dan HTTP ke port efemeral (Supertest tetap tidak dipakai). **Ditambah:** `shared/` sebagai satu-satunya paket bersama; adaptor Better Auth untuk NestJS; `@nestjs/bullmq` (dengan cadangan pembungkus tipis); aturan batas modul pada ESLint; baris lisensi NestJS; prasyarat P9 (spike S6). **Diubah:** Better Auth dipasang di backend dan diakses frontend pada origin yang sama; AI Worker, Document Worker, dan Outbox Dispatcher menjadi entrypoint codebase backend; stream hub berada pada Backend API; routing Caddy `/api/*` ke backend; `EditorPort` didefinisikan di `shared/` dengan adaptor di frontend dan backend. **Diperjelas:** cakupan lisensi EigenPal Pro pada P1 (tiga folder); prinsip integrasi 1, 2, dan 12; P2 dan P3 |
| 1.5 | **Diganti:** Webpack dihapus dari toolchain backend (backend memakai `tsc`; Webpack tetap untuk `word-add-in/`); Valkey 8.1 → 9.0.x; `@modelcontextprotocol/sdk` (v1) → `@modelcontextprotocol/client` v2; "middleware" Next.js → `proxy.ts`. **Ditetapkan (sebelumnya terbuka):** adaptor Better Auth `@thallesp/nestjs-better-auth`; TypeScript 6.x; Zod 4.x; PostgreSQL 17.x dengan pgvector 0.8.3; dimensi vektor `halfvec(1024)`; jalur embedding melalui endpoint embeddings OpenRouter dengan flag retensi nol; logging pino, `@nestjs/config`, `@nestjs/terminus`; TanStack Query dan React Hook Form; k6, Syft, Trivy, OSV-Scanner; pin image dengan tag eksak dan digest; Sentry `tunnel`; runner evals standalone. **Diperbaiki:** policy RLS memakai `NULLIF` (Arsitektur §3.2). **Ditambah:** tabel baseline versi (§7); baris lisensi Mike OSS (AGPL-3.0) dan catatan ExcelJS (§10); pemeriksaan telemetri dan keberlangsungan EigenPal pada P1; cakupan P9 diperluas |
| 1.7 | **Diganti:** `@assistant-ui/react-ai-sdk` → `@assistant-ui/ai-sdk`; Radix UI → Base UI (`@base-ui/react`, shadcn style `base-nova`). **Ditetapkan:** scaffold awal (templat `default` assistant-ui; `nest new` + cookbook AI SDK Nest.js); bahasa MVP Inggris untuk UI, konten, dan dokumentasi engineering; TypeScript tetap 6.x dan ESLint + Prettier tetap (alasan dicatat). **Ditambah:** rujukan ke Design System (LEX-DS-001) |
| 1.6 | **Dikeluarkan dari MVP:** `pgvector` 0.8.3, kolom `halfvec(1024)`, indeks HNSW, pencarian semantik, dan jalur embedding OpenRouter (beserta cadangan `@ai-sdk/openai-compatible`). **Diubah:** "Hybrid retrieval" menjadi retrieval keyword (FTS + `pg_trgm`) dengan konteks penuh untuk dokumen tunggal; AI SDK tidak lagi dipakai untuk embeddings; Document Worker mengakhiri pipeline pada chunking; P4 dan P9 disesuaikan; tabel baseline versi diperbarui. Penambahan kembali pencarian vektor memerlukan keputusan stack eksplisit (Arsitektur §4.3) |

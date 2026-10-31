# Mike — Kumpulan Diagram Arsitektur & Fitur (Excalidraw) — versi lengkap

53 diagram. Buka file `.excalidraw` di https://excalidraw.com (File → Open) atau ekstensi Excalidraw di VS Code.
Semua isi diverifikasi terhadap kode/docs repo https://github.com/open-legal-products/mike (snapshot saat dibuat).

## Urutan baca yang disarankan
1. `00-arsitektur-keseluruhan/00-big-picture-mike` — gambaran besar satu halaman
2. `00-arsitektur-keseluruhan/01-arsitektur-keseluruhan-detail` — semua komponen + rinciannya
3. `20-fitur/01-chat/` A → E — fitur inti, dari ringkasan sampai prompt & keamanan
4. `10-arsitektur-per-layer/` — frontend, backend, DB, Docker, LLM, dst.
5. `00-arsitektur-keseluruhan/peta-halaman-frontend-ke-router-backend` — halaman web → router API
6. `20-fitur/02…17` — fitur lain; folder yang punya beberapa diagram dibaca berurutan (A → B → C → D)
7. `00-arsitektur-keseluruhan/06-peta-interaksi-fitur` — bagaimana fitur saling terhubung

## Baru dibanding zip sebelumnya
- 07-tabular-review: A model data & siklus · B generate/ekstraksi sel · C lease, konkurensi, regenerate, pembersih · D chat atas tabel
- 16-word-addin: A peta modul & state · B satu giliran chat · C menerapkan edit (tracked change) · D backend word-chat & penyimpanan
- 13-organisasi: A peran, undangan, keanggotaan · B konten privat, kebijakan data, arsip, siklus org
- 17-privasi-data-dan-akun (baru): ekspor data · hapus massal & hapus akun
- 05-workflows B (berbagi & kirim open-source) · 06-playbooks C (model, aturan akses, editor)
- 00: peta halaman frontend → router backend

## Koreksi dari versi sebelumnya
- Konten privat organisasi: dapat dibuka oleh owner ATAU admin yang diberi `can_access_private_content` (per item, sebagai Viewer, tercatat di audit) — bukan owner saja.
- Kunci model: pekerjaan di organisasi memakai kunci org / kunci env server saja, tidak pernah kunci pribadi anggota (`getEffectiveApiKeys`).

## Catatan temuan
- Halaman `/support` mem-POST ke `/api/support` (diteruskan proxy ke `/support`), tetapi `backend/src/app.ts` tidak memasang router `/support` dan tidak ada rute itu di `backend/src`. Ini pengamatan atas snapshot repo ini.

## Isi folder
- 00-arsitektur-keseluruhan/ : big picture, detail, arsitektur sistem, peta interaksi fitur, peta halaman→API
- 10-arsitektur-per-layer/ : frontend, backend, DB, Docker/infra, Word add-in, desktop (Electron), lapisan LLM, monorepo/CI, job queue & memory, akses org & keamanan
- 20-fitur/ : 01 chat · 02 projects · 03 library · 04 dokumen · 05 workflows · 06 playbooks · 07 tabular review · 08 memory · 09 subagents · 10 konektor MCP · 11 riset · 12 auth · 13 organisasi · 14 ekspor & audit · 15 pengaturan · 16 Word add-in · 17 privasi data & akun

# F4.1 brand refresh prototype (draft, awaiting owner approval)

Built 2026-11-13 from the owner's LEXON Brand Kit v4.1 (02_DASHBOARD theme and
sidebar notes, logos, fonts). Live copy: https://claude.ai/artifact/1xFWhbFH5WxwAnHMZPDER6

- Light tokens: kit `lexon-shadcn-theme.css` (white, Ink #1A1718, Merah Segel #B3202A primary only).
- Dark tokens: derived by Claude (owner decision): bg #121011, card #1A1718, sidebar #181516,
  muted fg #A69FA1 (7.3:1), red text/ring #F0646C (6.1:1), primary button stays #B3202A (white 6.65:1).
- Type: EB Garamond (page headlines), Inter (UI/body), TeX Gyre Bonum (legal quotes, F8+).
- IA: sidebar-07 with English labels: Tools > Assistant (New chat, Chats); Recent; Matters group arrives with F6.
- Destructive: outline elsewhere; Merah Segel Deep #8E1A22 only for the confirm button in dialogs.
- Rebuild: `python3 -I source/build.py <dir with proto.src.html and assets>`; render: `node source/shoot.cjs <dir>`.

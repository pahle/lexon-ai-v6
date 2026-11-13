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

## Revision 2 (2026-11-13): PO asked for a less rigid chat UX

UX principles (our own words; behavior studied on the dirty side only, nothing copied):
inset sidebar with the content as a rounded card on the sidebar canvas; no hard header
border; centered new-chat start with a serif greeting (no logo; PO rev 4) and starter prompts;
elevated floating composer (soft shadow, pill toggles, round send) with a fade over
the thread and a scroll-to-latest button; reading-first answers (no bubble, 68ch,
line-height 1.75), animated Lexon mark while thinking/streaming (reduced-motion safe).
Personal workspace shows the Lexon monogram in the switcher.

## Revision 3 (2026-11-13): PO feedback
Wider layout (thread and composer 880px), no breadcrumb header (sidebar toggle left,
floating New chat / actions pill right), starter prompts as one row of short pills with
no "Try asking" label. Our reasoning display (Thought for N seconds + collapsible summary) stays.
Starter pills insert a short editable template into the composer; they never auto-send.

## Revision 5 (2026-11-13): no monogram on answers; thinking indicator options
Answers carry no avatar/monogram. Thinking indicator candidates (state `loaders`):
A column from the L's three pillars (cap + 3 pillars + base, light travelling across the pillars),
B highlighter (stabilo) band sliding across "Thinking…", C pen arc spinner. All reduced-motion safe.

## Revision 6 (2026-11-13): loader family
Owner wants a family of hand-drawn-feeling thinking animations (inspired by the idea of
Claude's varied marks; no Anthropic assets used). Six Lexon loaders, pure SVG/CSS, 20px in
UI and 72px preview (state `loaders`): Writing (signature stroke), Paper (page turn + lines),
Seal (stamp + inked ring, brand "cap"), Section marks (§ ¶ ⁂ † morph in EB Garamond),
Column (L's three pillars), Highlighter (stabilo over lines). One per turn; later slices may
tie them to activity (drafting, reading documents, approvals). Reduced motion: static frame.

## Revision 7 (2026-11-13): one morphing thinking indicator
PO: remove † and Seal, better Column, and transitions between marks instead of fade out/in.
Implemented as one continuous sequence (SVG + small JS, ~13 s cycle):
Section § → Writing → Paper → Highlighter → Column (courthouse: pediment, architrave,
three pillars catching light, two steps) → Pilcrow ¶ → again. Each mark draws itself,
breaks into 18 dots, the dots travel on staggered arcs to points sampled on the next mark,
and the next mark draws through them. Reduced motion: static §. `screens/fm-strip.png`
shows 24 frames at 0.5 s.

# Lexon brand package v4.1 (2026)

Extract of the product owner's **LEXON Brand Kit 2026, version 4.1**, limited to
what the application needs. It replaces the Royal Seal package in
[`../lexon-2026/`](../lexon-2026/README.md) for the interface (kept for history).
How the brand maps onto the interface (tokens for both themes, type roles,
logo placement, accessibility) is defined in
[LEX-DS-001 v3.0](../../specs/LEXON-03-DESIGN-SYSTEM.md).

## Contents

| Path | What | Use |
|---|---|---|
| `logo/LEXON-monogram-micro-seal.svg` | Monogram, seal red, micro tier | Personal workspace tile, thinking indicator and finished mark, favicon and app icons |
| `logo/LEXON-wordmark-compact-ink.svg` | Compact wordmark, ink | Auth pages on light surfaces (128px) |
| `logo/LEXON-wordmark-compact-white.svg` | Compact wordmark, white | Auth pages and covers on Night or dark surfaces |
| `logo/LEXON-wordmark-ink.svg` | Full wordmark, ink | Surfaces wider than 200px (rare in the app) |
| `fonts/EBGaramond-*.woff2` | EB Garamond (variable weight, roman and italic, Latin) | Page headlines; SIL Open Font License |
| `fonts/Inter-latin-wght.woff2` | Inter (variable weight, Latin) | Interface and body; SIL Open Font License |
| `fonts/TeXGyreBonum-*.woff2` | TeX Gyre Bonum (regular, bold, Latin) | Legal quotations (F8 onward); GUST Font License |
| `fonts/LICENSE-*.txt` | Font licenses | Ship them with the self-hosted fonts |
| `lexon-shadcn-theme.css` | The kit's shadcn theme (light only) | Reference for the light tokens in LEX-DS-001 v3.0 |

## Brand palette (kit v4.1)

| Name | Hex | Role |
|---|---|---|
| White | `#FFFFFF` | App surfaces |
| Ink | `#1A1718` | Text, logo tile in the team switcher |
| Surface | `#F5F4F4` | Sidebar canvas, user message bubble, secondary fills |
| Muted | `#6B6567` | Secondary text |
| Line Soft | `#ECEAEA` | Borders |
| Merah Segel | `#B3202A` | Primary actions and items Lexon flags for checking, only |
| Merah Segel Deep | `#8E1A22` | Confirm button inside destructive confirmation dialogs |
| Night | `#080606` | Auth cover panel |
| Tint | `#F7E6E8` | Reference numbers, highlights, pressed Deep thinking pill |

## Dashboard notes from the kit (translated)

The kit's dashboard design is built on the shadcn `sidebar-07` block with no
custom shell components:

- **Team switcher** (`TeamSwitcher` in `SidebarHeader`): organization initials
  on an ink tile, organization name, and member count. The Personal workspace
  shows the Lexon monogram instead (product owner decision, F4.1).
- **Tools** group (`NavMain`, the block's "Platform" group renamed): Assistant
  now; Tabular Review and Editor arrive in F13 and F14. The open tool is active
  and shows its sub-items.
- **Matters** group (`NavProjects`, renamed from "Projects"): arrives with F6.
- **User** (`NavUser` in `SidebarFooter`): the second line shows the job title
  instead of the email.
- All sizes are shadcn defaults.

The kit's labels are Indonesian; the application uses English labels (product
owner decision, F4.1): Tools, Assistant, New chat, Chats, Matters.

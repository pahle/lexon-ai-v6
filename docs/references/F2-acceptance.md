# F2 acceptance notes

## UI import and circular-shape lint coverage

ESLint rejects direct `radix-ui` and `@radix-ui/*` imports in owned frontend and
Word add-in files while allowing `@base-ui/react`. The `lexon/circular-shape`
rule checks literal JSX `className` strings and literal base/variant strings
passed to `cva`, including modifier-prefixed `rounded-full` tokens. Circular use
is permitted only in the radio indicator,
switch thumb, initials avatar, and status dot owner files, with a matching
semantic `data-slot` on JSX elements.

Dynamic class construction is intentionally outside this check. It does not
evaluate `cn(...)`, template expressions, variables, imported class strings, or
arbitrary radius utilities. Shape-policy fixtures document and exercise only
the static cases above; this is a bounded lint guard, not a general Tailwind
class analyzer.

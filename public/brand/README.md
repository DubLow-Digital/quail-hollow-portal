# Brand assets

Drop Quail Hollow's logo files here (PNG or SVG, transparent background preferred):

| File                  | Used for                                                          |
| --------------------- | ----------------------------------------------------------------- |
| `logo-horizontal.png` | Header on client and sign-in pages (nest + wordmark side by side) |
| `nest.png`            | Square mark (favicon-style uses, small spaces)                    |

When `logo-horizontal.png` is present at build time, the portal shows it instead of the
built-in text wordmark (see `next.config.ts`, `NEXT_PUBLIC_BRAND_LOGO`). Keep files small
(under 200 KB) so the header loads quickly on phones.

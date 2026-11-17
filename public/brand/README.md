# Brand assets

Drop Quail Hollow's logo files here (PNG or SVG, transparent background preferred):

| File                                    | Used for                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `logo-horizontal.png`                   | Header on client and sign-in pages (nest + wordmark side by side)                                                                   |
| `nest.png`                              | Square mark (favicon-style uses, small spaces)                                                                                      |
| `login-photo.webp` or `login-photo.jpg` | Right half of the sign-in page (horse in the field); a banner above the form on phones. Landscape, about 1600 px wide, under 400 KB |

When `logo-horizontal.png` is present at build time, the portal shows it instead of the
built-in text wordmark (see `next.config.ts`, `NEXT_PUBLIC_BRAND_LOGO`). Keep files small
(under 200 KB) so the header loads quickly on phones.

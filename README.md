# KetoCare

A paediatric ketogenic diet tracker for parents of children with epilepsy. Logs ketones, glucose, GKI, and seizures with timing detail. Generates clinic-ready PDF summaries for dietitian review.

## Deploy to GitHub Pages

1. Create a new GitHub repo (public).
2. Upload all the files in this folder to the repo root.
3. Go to **Settings → Pages**, set source to `main` branch, root folder. Save.
4. Wait ~30 seconds. Your app will be live at `https://<username>.github.io/<repo>/`.

That's it. No build step. No server.

## Add app icons (optional but recommended)

The PWA manifest references `icon-192.png` and `icon-512.png` but they're not included. Without icons, the "Add to Home Screen" experience will use a generic placeholder. Make two square PNGs (192×192 and 512×512) with the KetoCare aesthetic — warm cream background, sage or terracotta mark — and drop them in the same folder.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup for all 7 screens |
| `styles.css` | Design tokens + all styling |
| `db.js` | IndexedDB wrapper (settings, measurements, seizures) |
| `charts.js` | Chart.js config + line/bar charts |
| `export.js` | CSV (research zip), PDF clinic summary, JSON backup/restore |
| `app.js` | All UI logic — navigation, forms, timer, settings |
| `sw.js` | Service worker — caches everything for offline use |
| `manifest.json` | PWA manifest |

External dependencies (loaded via CDN, then cached locally by the service worker):
- Chart.js 4.4.0
- jsPDF 2.5.1
- JSZip 3.10.1
- Google Fonts (Fraunces, Manrope)

## What's included (v1)

- Fast seizure timer with full event detail (type, triggers, rescue med, recovery, notes)
- Manual seizure entry for retrospective logging
- Ketone tracking — blood (mmol/L) or urine (Negative → Very large), default in profile, override per entry
- Glucose tracking
- Auto-calculated GKI with target-band visual feedback
- History with daily grouping, filters, tap-to-edit, swipe-to-delete
- Trends — 7d / 30d / 90d view with stat cards (min/max/mean/n) and four charts
- Target-band shading on ketone and GKI charts
- **Research-grade data export** — zip containing tidy-format `measurements.csv`, `seizures.csv` (with each seizure linked to its nearest prior and subsequent ketone reading for proximity analysis), `daily_summary.csv`, and a `README_data.txt` data dictionary
- PDF clinic summary (header, stats, embedded chart images, full event log)
- JSON backup/restore (full app state)
- Local notification reminders (multiple per day)
- **Works fully offline** after first load — service worker caches the app shell
- All data stored locally in IndexedDB — never leaves the device unless exported manually

## Deferred to v2

- Cloud sync between devices (would require NHS DCB0129/0160 + DPIA assessment)
- Multi-child support (schema is ready — just needs a child picker)
- Meal/ratio logging
- Photo attachments for ketone strips, food, etc.
- Direct secure sharing to dietitian (vs email/AirDrop the export)
- Bluetooth ketone meter integration

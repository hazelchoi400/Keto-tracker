# KetoCare

A paediatric ketogenic diet tracker for parents of children with epilepsy. Logs ketones, glucose, GKI, and seizures with timing detail. Generates clinic-ready PDF summaries and an Excel workbook designed around the month-as-column view that clinicians already use.

Current version: **v1.5.1**.

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
| `index.html` | Markup for all 10 screens |
| `styles.css` | Design tokens + all styling |
| `db.js` | IndexedDB wrapper (settings, measurements, seizures) |
| `charts.js` | Chart.js config + calendar-bucketing helpers + chart wrappers |
| `export.js` | XLSX clinic spreadsheet, PDF clinic summary, JSON backup/restore |
| `app.js` | All UI logic — navigation, forms, timer, settings, screen rendering |
| `sw.js` | Service worker — caches everything for offline use |
| `manifest.json` | PWA manifest |

External dependencies (loaded via CDN, then cached locally by the service worker):
- Chart.js 4.4.0
- jsPDF 2.5.1
- SheetJS (xlsx) 0.18.5
- Google Fonts (Fraunces, Manrope)

## Features

### Logging
- Fast seizure timer with full event detail (type, triggers, rescue med, recovery, notes)
- Manual seizure entry for retrospective logging
- Custom seizure types — define your own labels in Settings (e.g. "focal with eye blinking", "head drop") which appear as chips alongside the standard ones
- "Other" seizure type with free-text description at log time
- Blood ketone tracking (v1.5 — urine option removed as it isn't used clinically)
- Glucose tracking
- Auto-calculated GKI with target-band visual feedback

### Configurable thresholds
- Target ranges for blood ketone and GKI (in-target = sage, out-of-target = terracotta)
- **Alert thresholds** for hyperketosis (default ≥6 mmol/L) and hypoglycaemia (default <3 mmol/L). When breached, the value goes terracotta with the message *"Give treatment as per management plan."*. All thresholds labelled "Set by your ketogenic diet centre" and editable in Settings.
- Diet variant — Classical 4:1 / 3:1 / 2:1, Custom ratio (free-text), MCT, MKD, MAD, LGIT.
- **KD start date (v1.5)** — when set, drives the "Since KD" range option, the default export window, and the "Started keto Mon YYYY" line on PDF/XLSX headers.

### Trends (basic)
- Range chips: **Since KD / 7d / 1m / 6m / 1y / Custom (v1.5)**
- Stat cards — min, max, mean, readings count
- Auto-bucketed charts: **daily** (≤7d), **calendar weekly** (8–60d), **calendar monthly** (>60d)
- AM vs PM split charts (default) with one-tap Combined fallback
- Ketone, Glucose, GKI, Seizure frequency
- For the parent on the school run who wants "is the number okay?"

### Patterns (advanced)
Accessed via "Look for patterns →" link at the bottom of Trends.
- Same range chips and auto-bucketing as Trends
- AM/PM stat cards — min/max/mean/readings split into AM and PM columns
- AM/PM ketone chart with seizure-bucket markers along the baseline
- **Seizure types over time as TABLES (v1.5)** — types as rows, time periods as columns, totals on the right. One table for frequency, one for median duration. Matches the parent-spreadsheet view that clinicians find easy to read. Replaces v1.3 small-multiples mini-charts.
- Seizures-by-hour-of-day histogram
- Day-of-week heatmap (Mon–Sun grid, terracotta gradient)
- Triggers tally — horizontal bar chart of trigger instances logged
- All views are **descriptive only, not for clinical decisions**

### Exports
- **PDF Summary report** — header (with "Started keto" date), stats, basic charts (auto-bucketed monthly for KD-since-start ranges), full Patterns section (AM/PM table, AM/PM ketone chart with seizure markers, **seizure types frequency + median-duration tables (v1.5)**, hour histogram, day-of-week heatmap, triggers tally), event log
- **XLSX Detailed records** — single Excel file with eight tabs:
  - **ReadMe** — first-sheet introduction explaining each tab and how they link
  - Summary — high-level period overview
  - **Monthly (v1.5)** — types as rows, time periods as columns, totals on the right; AM/PM ketone, glucose, GKI, readings, seizure-free days, median duration, rescue-med uses summarised below; blank notes block for clinician annotation
  - Daily — one row per day, AM/PM ketone, mean glucose, seizures, in-target flag
  - Measurements — every reading, long-format. ISO date column for joining across tabs
  - Seizures — every event, with nearest blood ketone before/after. ISO date column
  - Daily detail — long-format interleave of measurements and seizures with a `record_type` column. Useful for pivot tables and exploratory analysis
  - Patterns data — all in-app Patterns views as plain cells, with v1.5 calendar bucketing
- **JSON Backup/Restore** — full app state. Restore via the "Restore from backup" section on the Export screen.

### Other
- Visible app version + "Check for updates" button in Settings, so parents on desktop browsers aren't stuck on stale cached versions
- "What's new" changelog on the About page
- **Abbreviations panel on About (v1.5)** — KD / GKI / AM / PM / MCT / MAD / MKD / LGIT explained
- Works fully offline after first load — service worker caches the app shell
- All data stored locally in IndexedDB — never leaves the device unless exported manually

## Deferred to later versions

- Cloud sync between devices (would require NHS DCB0129/0160 + DPIA assessment)
- Multi-child support (schema is ready — just needs a child picker)
- Meal/ratio logging
- Photo attachments for ketone strips, food, etc.
- Direct secure sharing to dietitian or neurologist (vs email/AirDrop the export)
- Bluetooth ketone meter integration
- Reminder notifications (would need Push API + server, or a native app wrapper)
- Ketone-band binning of seizure rate (apophenia + denominator + matching + sample-size problems — see PROJECT_CONTEXT)

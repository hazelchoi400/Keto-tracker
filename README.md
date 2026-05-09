# KetoCare

A paediatric ketogenic diet tracker for parents of children with epilepsy. Logs ketones, glucose, GKI, and seizures with timing detail. Generates clinic-ready PDF summaries for dietitian review.

Current version: **v1.2**.

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
| `charts.js` | Chart.js config + line/bar/heatmap data + chart helpers |
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
- Ketone tracking — blood (mmol/L) or urine (Negative → Very large), default in profile, override per entry
- Glucose tracking
- Auto-calculated GKI with target-band visual feedback

### Configurable thresholds
- Target ranges for blood ketone and GKI (in-target = sage, out-of-target = terracotta)
- **Alert thresholds** for hyperketosis (default ≥6 mmol/L) and hypoglycaemia (default <3 mmol/L). When breached, the value goes terracotta with the message *"Give treatment as per management plan."*. All thresholds labelled "Set by your ketogenic diet centre" and editable in Settings.
- Diet variant — Classical 4:1 / 3:1 / 2:1, **Custom ratio (free-text)**, MCT, **MKD**, MAD, LGIT.

### Trends (basic)
- 7d / 30d / 90d ranges
- Stat cards — min, max, mean, readings count
- AM vs PM split charts (default) with one-tap Combined fallback
- Ketone, Glucose, GKI, Seizure frequency
- Calm and skimmable — for the parent who wants "is the number okay?"

### Patterns (advanced)
Accessed via "Look for patterns →" link at the bottom of Trends. Defaults to 90d.
- AM/PM stat cards — min/max/mean/readings split into AM and PM columns
- AM/PM ketone chart with seizure-day markers along the baseline
- Seizures-by-hour-of-day histogram
- Day-of-week heatmap (Mon–Sun grid, terracotta gradient)
- Triggers tally — horizontal bar chart of trigger instances logged
- All views are **descriptive only, not for clinical decisions**

### Exports
- **PDF Summary report** — header, stats, basic charts, full Patterns section (AM/PM table, AM/PM ketone chart with seizure markers, hour histogram, day-of-week heatmap, triggers tally), event log
- **XLSX Detailed records** — single Excel file with five tabs: Summary, Daily, Measurements, Seizures, About. Designed for clinic use; opens in Excel/Numbers, with conditional flags for in-target readings and each seizure linked to the nearest ketone reading on either side
- **JSON Backup/Restore** — full app state. Restore via the "Restore from backup" section on the Export screen.

### Other
- Local notification reminders (multiple per day)
- **Works fully offline** after first load — service worker caches the app shell
- All data stored locally in IndexedDB — never leaves the device unless exported manually

## Deferred to later versions

- Cloud sync between devices (would require NHS DCB0129/0160 + DPIA assessment)
- Multi-child support (schema is ready — just needs a child picker)
- Meal/ratio logging
- Photo attachments for ketone strips, food, etc.
- Direct secure sharing to dietitian (vs email/AirDrop the export)
- Bluetooth ketone meter integration
- Ketone-vs-seizure scatter / strip plot (apophenia risk at small sample sizes — reconsider when individual children have enough data per range to be informative)

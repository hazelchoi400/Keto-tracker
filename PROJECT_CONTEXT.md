# KetoCare — project context

A paediatric ketogenic diet tracker PWA for parents/carers of children with epilepsy. Logs ketones, glucose, GKI, and seizures. Generates clinic-ready summaries.

Built by Hazel Choi (UK paediatric dietitian).
Deployed at: `https://hazelchoi400.github.io/Keto-tracker/` (GitHub Pages).

Current version: **v1.3**.

---

## Architecture

**Vanilla JS PWA, split files, no build step.** Drop the folder onto GitHub Pages, it works.

### File layout

| File | Purpose |
|---|---|
| `index.html` | Markup for all 10 screens (Welcome, Home, Seizure timer, Seizure details, Measurement, History, Trends, Patterns, Export, Settings, About) |
| `styles.css` | All styling. Design tokens at the top. |
| `db.js` | IndexedDB wrapper exposed as `window.KCDB` |
| `charts.js` | Chart.js wrappers + data helpers exposed as `window.KCCharts` |
| `export.js` | XLSX, PDF, JSON exports as `window.KCExport` |
| `app.js` | All UI logic — navigation, forms, timer, settings, screen rendering |
| `sw.js` | Service worker — offline caching + update detection |
| `manifest.json` | PWA manifest |
| `icon-192.png`, `icon-512.png` | App icons (uploaded separately) |

### External dependencies (loaded via CDN, cached by SW)

- Chart.js 4.4.0 — trend charts
- jsPDF 2.5.1 — PDF clinic summary
- SheetJS (xlsx) 0.18.5 — Excel export
- Google Fonts: Fraunces (display serif), Manrope (UI sans)

### Data model

All in IndexedDB on the device. Nothing is uploaded.

```
settings:    { childName, dob, variant, customRatio,
               defaultKetone,
               ketoneMin/Max, gkiMin/Max,
               ketoneAlertHigh, glucoseAlertLow,
               customSeizureTypes[], reminders[],
               welcomeDismissed }
measurements: { id, timestamp, bloodKetone, urineKetone,
                glucose, notes, createdAt }
seizures:    { id, startTime, durationSec, type, typeOther,
               triggers[], rescueMed, recoveryMin,
               notes, createdAt }
```

Notes:
- `variant` is one of `custom`, `classical-4-1`, `classical-3-1`, `classical-2-1`, `mct`, `mkd`, `mad`, `lgit`. When `custom`, `customRatio` holds the free-text label (e.g. `"3.5:1"`).
- `customSeizureTypes` is an array of parent-defined labels. They render as extra chips on the seizure form alongside the standard ones, with `data-value="custom:N"` where `N` is the array index.
- A seizure record's `type` may be a standard value (`tonic-clonic`, `absence`, ...), `custom:N`, or `other`. When `other`, `typeOther` holds the free-text description entered at log time.
- `ketoneAlertHigh` and `glucoseAlertLow` are configurable thresholds labelled "set by your ketogenic diet centre" — defaults are 6 mmol/L and 3 mmol/L respectively. When breached, values render in terracotta with the message *"Give treatment as per management plan."*.

Urine ketone is encoded as the mmol/L midpoint of each strip band:
0 (Negative), 0.5 (Trace), 1.5 (Small +), 4 (Moderate ++), 8 (Large +++), 16 (Very large ++++).

---

## Design

**Aesthetic:** warm, parent-facing, calm. Not clinical white-and-blue, not cartoonish.

**Palette** (in `styles.css` `:root`):
- Background: warm cream `#f4ede2`
- Surface: `#fffaf2`
- Sage `#6b8a6b` and sage-deep `#4f6b4f` — measurements, in-target
- Terracotta `#c87864` and terracotta-deep `#a85a48` — seizures, out-of-target, alerts
- Honey `#d4a657` and honey-deep `#a37d35` — glucose
- Ink `#2d2a26` for primary text

**Typography:** Fraunces (display serif) for headings and large numerals. Manrope (sans) for UI and body text.

**Radii:** 10/16/22/28px. Generous, soft.

---

## Trends vs Patterns — the two-tier mental model

The app deliberately separates day-to-day skimming from exploratory analysis:

- **Trends (basic)** — for the parent on the school run who wants "is the number okay?". Four stat cards (min/max/mean/readings) + four line charts (ketone, glucose, GKI, seizure frequency). Default view is **AM vs PM split** (Combined available as a one-tap fallback). No seizure markers, no histograms, no heatmaps. Calm and skimmable.
- **Patterns (advanced)** — for the dietitian/neurologist or the more engaged parent who wants to look harder. Accessed via a soft "Look for patterns →" link at the bottom of Trends. Has its own screen header, intro disclaimer, range selector defaulting to 90d, and contains: AM/PM stat cards (4 metrics × AM/PM columns), a "Seizures by type" count panel (v1.3), AM/PM ketone chart with seizure-day markers, **seizure types over time — small multiples of frequency and median duration per type (v1.3)**, hour-of-day histogram, day-of-week heatmap, triggers tally.

**Why this matters:** trying to serve both audiences on one screen produced something that served neither well. The patterns page can show exploratory views without making clinical claims, and the basic page can stay calm.

**Patterns is descriptive only, never inferential.** No correlation calculations, no "predicted seizure risk" numbers, no claims about cause. Just more views of the same data. Parents should never see something that looks like a clinical conclusion the data doesn't support.

### Seizures-over-time small multiples (v1.3)

This view answers "is *this type* getting better, worse, or staying the same?" — a question the KD team routinely asks at clinic. One mini-chart per seizure type, in a grid. Two grids stacked: **Frequency** (counts per bucket) and **Duration** (median per bucket).

Key design choices, in case they're tempting to "improve":

- **No ketone overlay.** Deliberately kept off these charts. The moment ketone and frequency share a time axis, parents see a correlation that may or may not exist. The clinician puts the ketone chart and the type chart next to each other and makes the comparison themselves.
- **Per-type y-axis (auto-scale).** A child might have 20 absences and 1 tonic-clonic per month — shared scale would flatten the absences chart to invisibility. The question is "is *this type* changing?", not "which type is most common?". The count panel answers the latter.
- **Bucketing by range.** Weekly at 30d (4 buckets), monthly at 90d (3 × 30-day windows). Hard-coded, no toggle — the right choice is fairly obvious per range and toggles add cognitive load. Calendar months avoided because February breaks things; 30-day windows ending today are honest and predictable.
- **Right-most bucket is partial.** "This week" or "this 30-day window" — explicit in the chart note. Don't try to hide the partial bucket; the parent wants to see *current* state.
- **Median, not mean, for duration.** Mean is wrecked by a single status event. Below 3 events per bucket, switch to **dot-mode** — render each event's duration as an individual point instead of a median bar. This makes "n=2, not a meaningful average" visually obvious.
- **"Other" pooled.** All `other` events go into one mini-chart titled "Other (descriptions vary)". The clinical question still applies even when descriptions vary, and hiding them loses information.
- **Hidden at <14d.** Not enough buckets for a trend view. Card shows "Available at 30d or 90d range."

### Why feature 2 (ketone-band binning) was rejected

A natural companion idea was "show seizure rate at different ketone bands (low / low therapeutic / high therapeutic)". Considered and rejected for v1.3:

- **Denominator problem.** Frequency at "ketone <2" needs to be normalised by *time spent* at that band, not by event count. Parents check ketones more often when worried — exactly when seizures are more likely. The correlation appears even if it isn't real.
- **Matching problem.** Which ketone reading "belongs" to a seizure? Most-recent before? Nearest? Daily mean? Each choice gives a different answer and there's no clinically established convention.
- **Sample size.** A child with 6 seizures in 90 days, binned across 3 bands, averages 2 events per bin. Any bar chart from that looks meaningful and won't be.
- **Framing.** "Low therapeutic" / "high therapeutic" are loaded labels that imply clinical interpretation. A parent seeing "seizures at low ketone: 4; at high therapeutic: 1" will conclude "we need to push ketones higher" — a clinical decision that belongs with the keto team.

If this is ever revisited, do it in the XLSX export (clinician-facing) rather than the in-app Patterns view, and only after sample-size sanity checks. Probably also requires continuous ketone monitoring to be answerable honestly.

---

## Key product decisions (and why)

These are baked in. Worth remembering before anyone suggests changing them.

### Local-only storage, no cloud sync
Sidesteps NHS DCB0129/DCB0160 clinical-safety standards, GDPR DPIA burden, server costs, and authentication complexity. The app is a personal tracking tool by design. Parents export and share manually when they want to.

### Single child only (for now)
Schema includes `childId` placeholder (currently derived from name) so multi-child can be added later without migrating data.

### Ratio-flexible
Supports Classical 4:1 / 3:1 / 2:1, **Custom ratio (free-text)**, MCT, **MKD**, MAD, and LGIT. UK uses MKD; US/literature uses MAD — both retained because they're not strictly equivalent. Custom is for unusual ratios like 3.5:1 / 3.2:1.

### Framing as a "personal record-keeping tool, not medical advice"
Deliberately positions the app outside MHRA medical-device territory. The wording in the Welcome screen and About page is the legal/professional boundary. Don't change it lightly.

### Alert thresholds with soft messaging
When a ketone reading reaches the high threshold or glucose drops below the low threshold, the value goes terracotta and shows *"Give treatment as per management plan."* — never specific clinical instructions, never specific doses, never "call 999". The threshold values are configurable and labelled "Set by your ketogenic diet centre" so they're owned by the clinical team, not the app. Sidesteps "is the app diagnosing?" because the app is just flagging a number against a number — the same job a glucometer does.

### Emergency line is soft
"Follow your child's emergency care plan" rather than naming specific times or 999. More universal, doesn't imply the app knows when to act.

### "Who built this" section removed for now
Author identity intentionally not on the About page yet. Decide later — anonymous / first name only / full name + RD — based on how the app is shared and to whom.

### AM vs PM split is honest
Morning = 00:00–11:59, evening = 12:00–23:59 (boundary in `KCCharts.MORNING_END_HOUR`). The split is exposed as the default chart view because it lets parents/clinicians spot **individual** patterns in their child's data. **There is no established time-of-day pattern in the literature** — the split is exploratory, not confirming. The footnote on the in-app hour-of-day chart was deliberately trimmed to remove the disclaimer (it read as condescending in-context). The PDF version still carries the disclaimer because clinicians appreciate the framing on a printed report.

### Custom seizure types
Many neurologists describe a child's seizures with patient-specific labels ("focal with eye blinking", "head drop", "type 1 → tonic-clonic"). The app lets parents add up to several custom labels in Settings; they appear as chips alongside Tonic-clonic / Absence / Myoclonic / Focal / Drop / Other. "Other" still shows a free-text field for one-off descriptions. Custom labels resolve to human-readable strings in History, XLSX, and PDF.

### Three exports, three purposes
- **PDF Summary report** — printable. Header → stats table → basic charts (Combined mode) → **Patterns section on its own page** (AM/PM stats table + Seizures-by-type count list + AM/PM ketone chart with seizure markers + **seizure types over time, frequency + duration small multiples** + hour histogram + day-of-week heatmap + triggers tally) → event log. For clinic visits.
- **XLSX Detailed records** — single Excel file with seven tabs (v1.3): **ReadMe**, Summary, Daily, Measurements, Seizures, **Daily detail**, **Patterns data**. The Measurements and Seizures tabs each carry an ISO `Date` column in addition to the UK-formatted `Date (UK)` column, so cross-tab joins on date work cleanly. Daily detail is a long-format interleave of measurements and seizures with a `record_type` column — for pivot tables and exploratory analysis. Patterns data mirrors the in-app Patterns screen as plain cells with no images. Designed for clinicians, not researchers — terminology is "data" not "research" because that has ethical/regulatory implications.
- **JSON Backup** — full app state. For device migration or just safekeeping.

### Patterns custom date range (v1.3)
The Patterns chip group has a fourth "Custom…" option that expands an inline date-pair picker. Capped at 1 year. When active the chip relabels itself "Custom (5 Mar – 12 May)" so the loaded range is visible without re-opening the picker. State lives in `state.customPatternsRange = { fromMs, toMs }` — when both are set, the range overrides `selectedPatternsRange`.

Bucketing for the seizure-types-over-time view (and the Patterns data XLSX tab) auto-picks from range length:
- ≤21 days → weekly (7-day windows)
- 22–120 days → monthly (30-day windows)
- &gt;120 days → quarterly (90-day windows)

These are 30/90-day windows ending today, not calendar months/quarters — chosen to avoid the awkwardness of February-length variance and to keep the rightmost bucket always being "this period so far". Title shows the active bucketing (e.g. "Seizure types over time — monthly") so the reader knows what each bar represents.

Custom range is deliberately Patterns-only, not Trends. Trends is the calm-and-skimmable screen; adding a custom picker there muddies the school-run mental model. Patterns is the "you want to look harder" screen and the picker fits.

### CSV / "research" framing was rejected
Earlier iteration had a CSV-zip export with one-hot encoded triggers, unix timestamps, etc. Pulled back: "research" implies HRA approval and ethics review. The single XLSX with clinician-friendly columns is the right primary format for current use.

---

## Update workflow

The service worker caches everything for offline use, which means **uploading to GitHub doesn't automatically push updates to existing users**. The cache name in `sw.js` is the trigger.

### To ship an update

1. Edit your code as usual.
2. **Bump the version in `sw.js`** — change e.g. `'ketocare-v1.3'` to `'ketocare-v1.4'`.
3. Update the matching "Version" text on the About page in `index.html` so the visible version matches.
4. Drag all changed files into your GitHub repo (web upload — multiple files, one commit). GitHub will skip files with unchanged content.
5. Wait ~30 seconds for GitHub Pages to rebuild.
6. Next time a parent opens the app with internet, a sage banner slides down: *"An update is ready"* with a Refresh button. They tap it → page reloads → on the new version.

### Versioning convention

Semantic-style: `v1.0`, `v1.1`, `v1.2` for small changes; `v2.0`, `v3.0` for big ones. The cache name in `sw.js` and the "Version" line in About should always match.

You can ping-pong between any two names while testing — the browser only compares against currently cached state, not name history.

### What if you forget to bump the version
The new files are uploaded to GitHub, but existing users keep seeing the old version (served from their service-worker cache). They'll only get the new version after they uninstall + reinstall the app, or clear browser data. So: **always bump the cache name when shipping**.

---

## Update banner — how it works

In `app.js`, on every app load:
1. Service worker is registered (`navigator.serviceWorker.register('sw.js')`).
2. `reg.update()` forces a check against the server's `sw.js`.
3. If the file is byte-different from the cached one, browser installs the new SW in the background.
4. New SW finishes installing → page shows the sage banner via `showUpdateBanner()`.
5. User taps Refresh → page sends `{type: 'SKIP_WAITING'}` to the new SW → SW takes over → `controllerchange` event fires → page reloads.

In `sw.js`:
- `install` event caches everything in `PRECACHE`. Does NOT call `skipWaiting()` — waits for the page's permission.
- `message` event listens for `SKIP_WAITING` and calls `self.skipWaiting()`.
- `fetch` event uses cache-first for the app shell + CDN scripts, network-first for fonts.

---

## Charts module — what's in `KCCharts`

`charts.js` exposes one namespace with:

**Data builders:**
- `morningEveningSeries(records, valueKey, fromMs, toMs)` → `{ labels, morning, evening }`
- `dailySeries(records, valueKey, fromMs, toMs)` → `{ labels, data }` — combined daily mean
- `dailyCounts(records, fromMs, toMs)` → `{ labels, data }`
- `seizureDayMarkers(seizures, fromMs, toMs)` → `[{ index, count }]` — for baseline-marker overlays
- `seizuresByHour(seizures)` → `{ labels, data }` — 24-hour histogram
- `weeklyHeatmap(seizures, fromMs, toMs)` → `{ weeks, maxCount, totalSeizures }` — Mon–Sun grid
- `triggerCounts(seizures)` → `{ items, totalSeizures, seizuresWithTrigger }` — sorted desc with "No trigger noted" appended
- `computeStats(values)` → `{ min, max, mean, median, count }`
- `suggestedYMax(values, targetBand)` — y-axis fitting that doesn't get clipped by the band
- **v1.3** `resolveSeizureTypeLabel(seizure, settings)` — pure label resolver, used everywhere
- **v1.3** `seizureTypeCounts(seizures, settings)` → `[{ key, label, count }]` sorted desc — for the count panel
- **v1.3** `seizureTypeFrequencyByType(seizures, settings, fromMs, toMs, bucket)` → `[{ key, label, total, buckets: [{ start, end, label, count }] }]`
- **v1.3** `seizureTypeDurationByType(seizures, settings, fromMs, toMs, bucket)` → `[{ key, label, totalWithDuration, buckets: [{ start, end, label, count, median, durations[] }] }]`

**Chart renderers (Chart.js):**
- `lineChartCombined(canvasId, series, color, targetBand, markers, opts)` — single-line trend
- `lineChartSplit(canvasId, series, colorMorning, colorEvening, targetBand, opts)` — AM vs PM
- `barChart(canvasId, labels, data, color)` — vertical bars (seizure frequency)
- `horizontalBarChart(canvasId, labels, data, color)` — horizontal bars (triggers)
- `hourHistogramChart(canvasId, data, color)` — 24-hour histogram with sparse axis ticks at 0/6/12/18
- **v1.3** `seizureTypeSmallMultipleChart(canvasId, buckets, color, mode)` — one mini-chart, one type, one metric; dot-mode for buckets with <3 events in duration mode

**Critical Chart.js patterns to preserve:**
- Target-band datasets are labelled with a leading `_` (e.g. `_targetMax`, `_targetMin`, `_seizureMarkers`). Tooltip and legend filters key off this prefix to hide them. This fixes the v1.0 bug where the target band leaked into the tooltip as a phantom number.
- Y-axis uses `suggestedMax` from `suggestedYMax()` so values above the target band are never clipped (the v1.0 bug where 6.8 mmol/L readings were invisible because the band capped the scale at 5).

---

## PDF rendering — off-screen Chart.js + direct jsPDF

Charts are rendered to off-screen 1200px canvases at PDF time, captured via `toDataURL`, then destroyed. Don't be tempted to "simplify" this by reading from the visible Trends canvases — that approach failed because the user might not have visited Trends/Patterns before exporting.

Helpers in `export.js`:
- `renderOffscreenCombinedLineChartToPDF` — main basic chart
- `renderOffscreenSplitLineChartToPDF` — Patterns AM/PM ketone chart with seizure markers
- `renderOffscreenBarChartToPDF` — seizure frequency
- `renderOffscreenHourHistogramToPDF` — hour-of-day histogram
- `renderOffscreenHorizontalBarChartToPDF` — triggers tally
- `renderHeatmapToPDF` — **drawn directly with jsPDF rectangles**, not Chart.js. There's no Chart.js heatmap type in this build, and html2canvas would add a heavy dependency. Cells are filled rects with terracotta opacity scaled by count, manually mixed against the cream background because jsPDF doesn't support RGBA.
- `renderPatternsStatsTable` — direct jsPDF text/table for the AM/PM stats grid (small enough that an off-screen render isn't worth the cost).

---

## Known gotchas

### Service workers only run on HTTPS or localhost
You can't preview the app properly by double-clicking `index.html`. The SW won't register on `file://`. To test locally, run `python3 -m http.server` from the folder, open `http://localhost:8000`. Or just upload to GitHub Pages and test there.

### iOS ignores the manifest icons
iOS Safari uses `<link rel="apple-touch-icon">` for "Add to Home Screen", not the manifest. That tag is in `index.html` and points at `icon-192.png`. Without that file, iOS shows a generated "K" placeholder.

### iOS caches the home-screen icon at install time
If a parent added the app to their home screen *before* the icon files existed, they'll still see the placeholder. Fix: long-press → Remove → re-add from Safari.

### State.settings preservation in form save
`handleSettingsSubmit()` uses `{ ...state.settings, ...formFields }` to preserve flags like `welcomeDismissed`. If you add new settings fields not in the form, they'll be preserved automatically. Don't change this to a plain object literal.

### data-go nav inside forms
The global `data-go` click handler skips clicks inside `<form>` elements unless the click target is an explicit `<button type="button">`. This is what makes the "About KetoCare" link inside Settings work without triggering form submit.

### Charts in PDF render off-screen
See "PDF rendering" section above. Each off-screen helper creates a hidden 1200px-wide canvas, attaches it to the body off-screen, renders Chart.js, captures via `toDataURL`, then destroys it.

### Heatmap auto-hides at 7d
At 7 days the heatmap is one row of 7 cells — not a heatmap. `renderHeatmap()` in `app.js` shows a "Heatmap available at 30d or 90d range" message instead. Patterns defaults to 90d so this rarely matters.

### Don't show parents inferred patterns or correlations
The Patterns screen is **descriptive only**. Resist the temptation to add "ketone-seizure correlation: 0.43" or "predicted seizure risk: low" — at typical sample sizes these are misleading and parents will treat them as clinical guidance. Show the data; let the dietitian/neurologist do the inference.

### Patterns range is independent of Trends range
Each screen has its own range chip and its own `state.selectedTrendRange` / `state.selectedPatternsRange`. Don't combine them; they serve different mental modes.

---

## Roadmap (deferred features, in rough priority order)

These were considered and explicitly deferred. Decide each one fresh if/when you revisit.

| Feature | Why deferred | Notes |
|---|---|---|
| Cloud sync between devices | NHS DCB0129/0160 + GDPR DPIA burden | Would need real medical-device process if framed as clinical |
| Multi-child support | Unclear demand from current users | Schema ready (childId placeholder) |
| Meal/ratio logging | Out of scope for tracker; complex food data | The dietitian's domain, not the app's |
| Photo attachments (ketone strips, food) | Storage concerns, IP/consent on photos | |
| Direct secure dietitian sharing | Authentication, server, GDPR | Currently parents export + share manually |
| Bluetooth ketone meter integration | Web Bluetooth iOS support is poor | Manual entry works for now |
| Ketone-vs-seizure scatter / strip plot | Apophenia risk at small sample sizes | Considered for Patterns, deferred. Parents may infer causation from clusters that are noise. Reconsider when individual children have enough data per range to be informative. |
| Urine ketone target range | Not clinically recommended; mean/min/max meaningless on banded data | Logging stays available; no target shown |
| App store listing | Apple £79/yr, Google £25 once + review processes | PWA install is "good enough" until proven otherwise |
| Custom domain (ketocare.app etc) | Costs ~£15/yr, also raises "are you a real product?" question | The github.io URL is fine for friends-and-family stage |
| Author credentials on About page | Liability and professional considerations unresolved | Leave generic for now |

### Phase 1 (current — quiet sharing)
Friends and a small group of patient families. PWA on GitHub Pages. Local data only. Author anonymous in About page. No formal feedback channel.

### Phase 2 (later — broader sharing)
Custom domain, app store listing, formal author credit, written feedback channel. Possibly a one-page landing site explaining what the app is.

### Phase 3 (much later — possibly never)
Cloud, accounts, dietitian dashboard, NHS integration. This stops being a side project. Would need co-founders, funding, or a parent organisation (charity like Matthew's Friends, or a hospital trust).

---

## Validation plan (before considering Phase 2)

The most useful next step is **not** to build more features. It's to watch 5 real parents use what's already built. Sit with them, watch them, ask:
- When would you actually open this?
- What would stop you using it?
- Show me how you currently track this stuff.
- What's missing?

Most apps in this space die between Phase 1 and Phase 2 because the founder never validates that anyone actually wants it before piling on more work.

---

## When working on this codebase with an AI assistant

- The code is split into 9 files. Always check `index.html` for screen markup, `app.js` for logic, `styles.css` for design.
- Design tokens live in `:root` in `styles.css`. Use the existing palette and radii rather than inventing new ones.
- `state.settings` is the source of truth for user-configurable values. It's loaded from IndexedDB on init and re-read in `renderHome()`.
- All chart rendering goes through `KCCharts` helpers. Don't call Chart.js directly outside `charts.js`.
- The PDF and XLSX exports are independent — changes to one don't affect the other. The PDF includes a Patterns section; the XLSX does not (clinicians have timestamps and can split however they like).
- Before adding anything to the **basic Trends** screen, ask: does this serve "parent on the school run wants the headline number"? If not, it probably belongs in **Patterns**.
- Before adding anything to **Patterns**, ask: is this a description of the data, or an inference from it? Only descriptive views are appropriate. Calculated correlations, predictions, or risk scores cross the line.
- Always bump `CACHE_NAME` in `sw.js` when shipping changes that should reach existing users.
- Local testing: run `python3 -m http.server` in the project folder, open `http://localhost:8000`. SW won't work via `file://`.

---

*Last updated: May 2026 (v1.3)*

# KetoCare — project context

A paediatric ketogenic diet tracker PWA for parents/carers of children with epilepsy. Logs ketones, glucose, GKI, and seizures. Generates clinic-ready summaries.

Built by a UK paediatric dietitian (author identity intentionally kept off the public-facing app for now — see decisions below).
Deployed at: `https://hazelchoi400.github.io/Keto-tracker/` (GitHub Pages).

Current version: **v1.5.2**.

---

## Architecture

**Vanilla JS PWA, split files, no build step.** Drop the folder onto GitHub Pages, it works.

### File layout

| File | Purpose |
|---|---|
| `index.html` | Markup for all 10 screens (Welcome, Home, Seizure timer, Seizure details, Measurement, History, Trends, Patterns, Export, Settings, About) |
| `styles.css` | All styling. Design tokens at the top. |
| `db.js` | IndexedDB wrapper exposed as `window.KCDB` |
| `charts.js` | Chart.js wrappers + calendar-bucketing helpers + data builders, exposed as `window.KCCharts` |
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
settings:    { childName, kdStartDate, variant, customRatio,
               ketoneMin/Max, gkiMin/Max,
               ketoneAlertHigh, glucoseAlertLow,
               customSeizureTypes[],
               welcomeDismissed,
               // legacy (no longer in UI, kept for backup round-trips):
               dob, defaultKetone, reminders[] }
measurements: { id, timestamp, bloodKetone, urineKetone (legacy),
                glucose, notes, createdAt }
seizures:    { id, startTime, durationSec, type, typeOther,
               triggers[], rescueMed, recoveryMin,
               notes, createdAt }
```

Notes:
- `kdStartDate` (v1.5) — ISO `YYYY-MM-DD`. Drives the "Since KD" range option, the default export window, and the "Started keto Mon YYYY" line on PDF/XLSX headers. Replaces v1.4's `dob` field which never appeared anywhere clinically useful.
- `variant` is one of `custom`, `classical-4-1`, `classical-3-1`, `classical-2-1`, `mct`, `mkd`, `mad`, `lgit`. When `custom`, `customRatio` holds the free-text label (e.g. `"3.5:1"`).
- `customSeizureTypes` is an array of parent-defined labels. They render as extra chips on the seizure form alongside the standard ones, with `data-value="custom:N"` where `N` is the array index.
- A seizure record's `type` may be a standard value (`tonic-clonic`, `absence`, ...), `custom:N`, or `other`. When `other`, `typeOther` holds the free-text description entered at log time.
- `ketoneAlertHigh` and `glucoseAlertLow` are configurable thresholds labelled "set by your ketogenic diet centre" — defaults are 6 mmol/L and 3 mmol/L respectively. When breached, values render in terracotta with the message *"Give treatment as per management plan."*.
- `urineKetone` is a legacy field. The urine ketone input was removed in v1.5 (clinical decisions are made on blood ketone; urine is rarely used in practice). The field stays on the schema and is conditionally surfaced in the XLSX Measurements tab when any record has urine data, so older parents' historical readings aren't silently dropped.
- `dob`, `defaultKetone`, `reminders` — all legacy. Kept on the schema so older backups restore cleanly; not surfaced anywhere in the UI.

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

- **Trends (basic)** — for the parent on the school run who wants "is the number okay?". Four stat cards (min/max/mean/readings) + four line/bar charts (ketone, glucose, GKI, seizure frequency). Default view is **AM vs PM split** (Combined available as a one-tap fallback). Calm and skimmable.
- **Patterns (advanced)** — for the dietitian/neurologist or the more engaged parent who wants to look harder. Accessed via a soft "Look for patterns →" link at the bottom of Trends. Has its own screen header, intro disclaimer, range selector, and contains: AM/PM stat cards (4 metrics × AM/PM columns), AM/PM ketone chart with seizure-bucket markers, seizure types over time (frequency + duration as **tables**, not charts), hour-of-day histogram, day-of-week heatmap, triggers tally.

**Why this split matters:** trying to serve both audiences on one screen produced something that served neither well.

**Patterns is descriptive only, never inferential.** No correlation calculations, no "predicted seizure risk" numbers, no claims about cause. Just more views of the same data. Parents should never see something that looks like a clinical conclusion the data doesn't support.

### Seizure types over time — tables, not charts (v1.5)

Two stacked tables, **types as rows, time periods as columns** — matches what the keto team's manual spreadsheets look like at clinic.

- **Frequency table**: per-type counts per period, with an "All seizures" row at the bottom and a "Total" column on the right.
- **Duration table**: per-cell `total (median*)` where `*` flags medians from fewer than 3 events. Two summary rows at the bottom — "Total duration" and "Median per period".

Cells for partial buckets (e.g. when KD started mid-month) get a subtle terracotta tint to flag that the period is shorter. Single-event cells show only the total (the "median of one" is just the event itself).

The previous v1.3 small-multiples mini-charts approach was abandoned because tiny charts read dishonestly at small numbers — parents inferred trends from 3-pixel bars. Tables make "n=2" look like "n=2".

### Range chips and auto-bucketing

Both Trends and Patterns share the chip set: **Since KD / 7d / 1m / 6m / 1y / Custom**. The Since-KD chip is hidden until a start date is set in Settings. Once set, the default range switches to "Since KD" on the off→on transition (but doesn't override the user's explicit choices afterwards).

Auto-bucketing is computed from the active range:
- ≤7 days → daily
- 8–60 days → calendar weekly (Mon–Sun)
- \>60 days → calendar monthly (Apr 23, May 23, …)

Calendar-anchored, not rolling — so a 13-month "Since KD" range produces exactly the columns the parent's-spreadsheet workflow already uses (`Apr 23 (from 14) · May 23 · Jun 23 · … · May 24 (to 15)`). First/last buckets may be partial and are labelled to make that visible.

---

## Key product decisions (and why)

These are baked in. Worth remembering before anyone suggests changing them.

### Local-only storage, no cloud sync
Sidesteps NHS DCB0129/DCB0160 clinical-safety standards, GDPR DPIA burden, server costs, and authentication complexity. The app is a personal tracking tool by design. Parents export and share manually when they want to.

### Single child only (for now)
Schema includes `childId` placeholder (currently derived from name) so multi-child can be added later without migrating data.

### Ratio-flexible
Supports Classical 4:1 / 3:1 / 2:1, Custom ratio (free-text), MCT, MKD, MAD, and LGIT. UK uses MKD; US/literature uses MAD — both retained because they're not strictly equivalent. Custom is for unusual ratios like 3.5:1 / 3.2:1.

### "Personal record-keeping tool, not medical advice"
Deliberately positions the app outside MHRA medical-device territory. The wording in the Welcome screen and About page is the legal/professional boundary. Don't change it lightly.

### KD start date replaces DOB (v1.5)
Date of birth was on the v1.4 Settings form but never appeared anywhere clinically useful — clinicians know the child's age. KD start date is what they actually use in conversation ("she's been on keto since April"). Replacing DOB with KD start removed a data point that was personal-without-utility and added one that drives multiple downstream features (Since-KD range, default export window, PDF header line).

### Urine ketone removed (v1.5)
The urine ketone input was removed because clinical decisions are made on blood ketone in practice. Older records' urine values aren't deleted — the XLSX Measurements tab still shows the column when any record has a urine value, so historical data survives.

### Alert thresholds with soft messaging
When a ketone reading reaches the high threshold or glucose drops below the low threshold, the value goes terracotta and shows *"Give treatment as per management plan."* — never specific clinical instructions, never specific doses, never "call 999". The threshold values are configurable and labelled "Set by your ketogenic diet centre" so they're owned by the clinical team, not the app. Sidesteps "is the app diagnosing?" because the app is just flagging a number against a number — the same job a glucometer does.

### Emergency line is soft
"Follow your child's emergency care plan" rather than naming specific times or 999. More universal, doesn't imply the app knows when to act.

### Author identity intentionally vague in-app
"Who built this" is not on the About page. Decide later — anonymous / first name only / full name + RD — based on how the app is shared and to whom. The current About page footer just shows the version. (External pitch documents are a different surface and can carry attribution if appropriate.)

### AM vs PM split is honest, not confirmatory
Morning = 00:00–11:59, evening = 12:00–23:59 (boundary in `KCCharts.MORNING_END_HOUR`). The split is exposed as the default chart view because it lets parents/clinicians spot **individual** patterns in their child's data. **There is no established time-of-day pattern in the literature** — the split is exploratory, not confirming. The footnote on the in-app hour-of-day chart was deliberately trimmed to remove the disclaimer (it read as condescending in-context). The PDF version still carries the disclaimer because clinicians appreciate the framing on a printed report.

### Custom seizure types
Many neurologists describe a child's seizures with patient-specific labels ("focal with eye blinking", "head drop", "type 1 → tonic-clonic"). The app lets parents add up to several custom labels in Settings; they appear as chips alongside Tonic-clonic / Absence / Myoclonic / Focal / Drop / Other. "Other" still shows a free-text field for one-off descriptions. Custom labels resolve to human-readable strings in History, XLSX, and PDF via `KCCharts.resolveSeizureTypeLabel(seizure, settings)`.

### Three exports, three purposes (v1.5)

- **PDF Summary report** — printable. Header (with "Started keto" date) → stats table → basic charts (auto-bucketed) → Patterns section (AM/PM stats table + AM/PM ketone chart with seizure markers + seizure-type frequency + duration **tables** + hour histogram + day-of-week heatmap + triggers tally) → event log. For clinic visits.
- **XLSX Detailed records** — single Excel file with **seven** tabs:
  - **ReadMe** — first-sheet introduction explaining each tab and how they link
  - **Summary** — high-level period overview
  - **Monthly** — the clinic-prep view. Types as rows, calendar buckets (e.g. months) as columns. Seven content chunks: physiology means, type frequency, type total duration, type median duration, seizures by hour of day, seizures by day of week, triggers tally. Plus outcome rows (seizure-free days, rescue med uses) and empty notes block at the bottom.
  - **Daily** — one row per day. AM/PM ketone, mean glucose, seizures, in-target flag.
  - **Measurements** — every reading. ISO date column for joining across tabs. Urine column conditional on legacy data presence.
  - **Seizures** — every event with nearest blood ketone before/after. Dual-date columns.
  - **Daily detail** — long-format interleave of measurements and seizures with a `record_type` column. For pivot tables.

  (The v1.3 standalone "Patterns data" tab was removed in v1.5 — its content is folded into Monthly so clinicians read everything in one place rather than tab-hopping.)
- **JSON Backup** — full app state. For device migration or just safekeeping.

### CSV / "research" framing was rejected
Earlier iteration had a CSV-zip export with one-hot encoded triggers, unix timestamps, etc. Pulled back: "research" implies HRA approval and ethics review. The single XLSX with clinician-friendly columns is the right primary format.

### Reminders feature was removed (v1.4)
The `reminders: []` field stays on the schema so older backups restore cleanly, but the UI is gone. PWAs can't fire reliable background timers — `setTimeout` only runs while the page is open, and browsers suspend idle pages within seconds-to-minutes of backgrounding. Real background notifications would need either Push API + server scheduler (which collapses the local-only architecture) or a native iOS/Android wrapper. Neither fits Phase 1.

### Update visibility on the Home screen (v1.4) + reliability fixes (v1.5.1)

Service worker caching is great for offline but creates a real UX problem: browsers can cling to the old cached SW indefinitely. Several things work together:

1. **Small footer on Home**: `Running vX.X.X · Check for updates · Force refresh`. The label is rendered by `renderHomeVersionLabel()` each time Home is shown.
2. **`visibilitychange` re-check.** When the tab is brought back to focus, `app.js` calls `reg.update()` automatically.
3. **`updateViaCache: 'none'`** on SW registration (v1.5.1) — tells the browser never to use the HTTP cache when fetching `sw.js` for update checks. Fixes the case where a freshly-deployed sw.js sat hidden behind a stale `Cache-Control: max-age=600` from GitHub Pages.
4. **Hard fetch before manual check** (v1.5.1) — `handleCheckForUpdates` does `fetch('sw.js?v=' + Date.now(), { cache: 'no-store' })` before calling `reg.update()`. Belt-and-braces.
5. **Force refresh** (v1.5.1) — escape-hatch button that unregisters all SWs, deletes all caches, hard-reloads with a cache-buster. IndexedDB data is preserved.
6. **"What's new" expandable panel** on the About page. Captures the changelog inline. Each version bump should add an entry at the top of this list in `index.html`.

---

## Charts module — what's in `KCCharts`

`charts.js` exposes one namespace with:

**Calendar bucketing (v1.5):**
- `autoBucketForDays(days)` → `{ bucket, label }` — picks `'day'` / `'calendar-week'` / `'calendar-month'` from a range length
- `_buildBuckets(fromMs, toMs, bucket)` → `[{ start, end, label, isPartial }]` — extends to handle calendar-anchored buckets in addition to legacy rolling windows
- `bucketedSeries(records, valueKey, fromMs, toMs, bucket)` → `{ labels, data, buckets }`
- `bucketedMorningEveningSeries(records, valueKey, fromMs, toMs, bucket)` → `{ labels, morning, evening, buckets }`
- `bucketedCounts(records, fromMs, toMs, bucket)` → `{ labels, data, buckets }`
- `seizureBucketMarkers(seizures, fromMs, toMs, bucket)` → `[{ index, count }]`
- `seizureTypesByPeriodTable(seizures, settings, fromMs, toMs, bucket)` → `{ bucket, bucketLabel, buckets, types: [{ key, label, totalCount, totalDurations, cells: [{ count, durations, median }] }] }`

**Other data builders:**
- `morningEveningSeries`, `dailySeries`, `dailyCounts` (legacy daily-only — still used in a few places)
- `seizureDayMarkers` (legacy — pre-v1.5)
- `seizuresByHour`, `weeklyHeatmap`, `triggerCounts`, `seizureTypeCounts`
- `computeStats(values)` → `{ min, max, mean, median, count }`
- `suggestedYMax(values, targetBand)` — y-axis fitting that doesn't get clipped by the band
- `resolveSeizureTypeLabel(seizure, settings)` — pure label resolver

**Chart renderers (Chart.js):**
- `lineChartCombined`, `lineChartSplit`, `barChart`, `horizontalBarChart`, `hourHistogramChart`

**Critical Chart.js patterns to preserve:**
- Target-band datasets are labelled with a leading `_` (e.g. `_targetMax`, `_targetMin`, `_seizureMarkers`). Tooltip and legend filters key off this prefix to hide them. Fixes the v1.0 bug where the target band leaked into the tooltip as a phantom number.
- Y-axis uses `suggestedMax` from `suggestedYMax()` so values above the target band are never clipped.

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
- `renderPatternsStatsTable` — direct jsPDF text/table for the AM/PM stats grid (small enough that an off-screen render isn't worth the cost)
- `renderSeizureTypesFrequencyTableToPDF` + `renderSeizureTypesDurationTableToPDF` (v1.5) — type×period tables drawn directly with jsPDF. Auto-shrink font + column widths to fit page width.

---

## XLSX export — seven tabs (v1.5)

`exportXLSX(fromMs, toMs)` in `export.js` builds the workbook. Tab order is deliberate:

1. **ReadMe** — first sheet, so anyone receiving the file cold sees how it fits together. Explains each tab and tells the reader to join on the ISO `Date` column. Includes app version, period, child name, KD start, diet variant.
2. **Summary** — high-level period overview, one table.
3. **Monthly** — the clinic-prep view. Seven content chunks (physiology, type frequency, type total duration, type median duration, hour-of-day, day-of-week, triggers tally), outcome rows, notes block. Bucketing follows `autoBucketForDays`.
4. **Daily** — one row per day.
5. **Measurements** — every reading. Conditional urine column.
6. **Seizures** — every event with nearest blood ketone before/after.
7. **Daily detail** — long-format interleave with `record_type` column.

The v1.3 standalone "Patterns data" tab was removed in v1.5; its content is in the Monthly tab.

---

## Update workflow

The service worker caches everything for offline use, which means **uploading to GitHub doesn't automatically push updates to existing users**. The cache name in `sw.js` is the trigger.

### To ship an update

1. Edit your code as usual.
2. **Bump three values in lockstep:** `CACHE_NAME` in `sw.js`, `APP_VERSION` in `app.js`, and the version line on the About page in `index.html`.
3. Bump the version in the XLSX ReadMe (`'App version     v1.x.x'` in `export.js`).
4. Add a "What's new" entry at the top of the changelog panel in `index.html`.
5. Drag all changed files into your GitHub repo. GitHub will skip files with unchanged content.
6. Wait ~30 seconds for GitHub Pages to rebuild.
7. Next time a parent opens the app with internet, the sage banner slides down. They tap Refresh → page reloads → on the new version.

### What if you forget to bump the version
The new files are uploaded to GitHub, but existing users keep seeing the old version (served from their service-worker cache). They'll only get the new version after they uninstall + reinstall the app, or clear browser data. So: **always bump the cache name when shipping**.

---

## Known gotchas

### Service workers only run on HTTPS or localhost
You can't preview the app properly by double-clicking `index.html`. The SW won't register on `file://`. To test locally, run `python3 -m http.server` from the folder, open `http://localhost:8000`. Or just upload to GitHub Pages and test there.

### Chrome on desktop clings to the old SW
A persistent UX hazard. Even after you ship a new version, Chrome on Mac/Windows can keep serving the old cached version for a long time. v1.5.1's `updateViaCache: 'none'` + hard-fetch helps. Force refresh in the Home footer is the user-facing escape hatch.

### iOS home-screen WebApps are flaky
iOS aggressively suspends WebApps and the SW lifecycle there is genuinely flaky. No software-only fix is 100% reliable. Force refresh exists for this reason. Tell test users about it.

### Safari `NotReadableError` on JSON import (Mac)
The file picker sometimes throws *"The requested file could not be read..."* on Safari for Mac (and occasionally iOS). It's a known WebKit issue — Safari's file reference can go stale between the picker dialogue and the actual read, especially for files in iCloud Drive or Downloads. Workaround: move the file to Desktop and try again, or use a different browser. Not worth in-app handling at the current scale.

### iOS ignores the manifest icons
iOS Safari uses `<link rel="apple-touch-icon">` for "Add to Home Screen", not the manifest. That tag is in `index.html` and points at `icon-192.png`. Without that file, iOS shows a generated "K" placeholder.

### iOS caches the home-screen icon at install time
If a parent added the app to their home screen *before* the icon files existed, they'll still see the placeholder. Fix: long-press → Remove → re-add from Safari.

### State.settings preservation in form save
`handleSettingsSubmit()` uses `{ ...state.settings, ...formFields }` to preserve flags like `welcomeDismissed` and legacy fields (`dob`, `defaultKetone`, `reminders`, `urineKetone` on individual records). Don't change to a plain object literal.

### data-go nav inside forms
The global `data-go` click handler skips clicks inside `<form>` elements unless the click target is an explicit `<button type="button">`. This is what makes the "About KetoCare" link inside Settings work without triggering form submit.

### Don't show parents inferred patterns or correlations
The Patterns screen is **descriptive only**. Resist the temptation to add "ketone-seizure correlation: 0.43" or "predicted seizure risk: low" — at typical sample sizes these are misleading and parents will treat them as clinical guidance. Show the data; let the dietitian/neurologist do the inference.

### Bucket builder edge cases
`_buildBuckets()` handles partial first/last calendar buckets with `(from N)` / `(to N)` labels; the `isPartial` flag is set so renderers can tint them. The legacy rolling-window path (`'week'`, `'month'`, `'quarter'`) still exists for any old callers but is not used by anything v1.5+.

---

## Roadmap (deferred features, in rough priority order)

These were considered and explicitly deferred. Decide each one fresh if/when you revisit.

| Feature | Why deferred | Notes |
|---|---|---|
| Day-of-month or weekday × month heatmap | Pending design decision | Clinical feedback: day-of-week is low signal alone; aggregating across many weeks (weekday × month) may be more useful |
| Reminders via Push API + server | Breaks local-only architecture; brings back NHS DCB0129/0160 + DPIA + auth | Or via native app wrapper instead |
| Cloud sync between devices | NHS DCB0129/0160 + GDPR DPIA burden | Would need real medical-device process if framed as clinical |
| Multi-child support | Unclear demand from current users | Schema ready (childId placeholder) |
| Meal/ratio logging | Out of scope for tracker; complex food data | The dietitian's domain, not the app's |
| Photo attachments | Storage concerns, IP/consent | |
| Direct secure dietitian/neurologist sharing | Authentication, server, GDPR | Currently parents export + share manually |
| Bluetooth ketone meter integration | Web Bluetooth iOS support is poor | Manual entry works for now |
| Ketone-vs-seizure scatter / band binning | Apophenia risk at small sample sizes | Denominator problem, matching problem, sample-size problem. May revisit only in XLSX form. |
| Urine ketone target range | Not clinically recommended | Legacy data still displayed; no target shown |
| Safari `NotReadableError` retry | Edge case, easy manual workaround | Add catch + retry |
| App store listing | Apple £79/yr, Google £25 once + review | PWA install is "good enough" until proven otherwise |
| Custom domain (ketocare.app etc) | Cost + raises "are you a real product?" question | github.io URL is fine for friends-and-family stage |
| Author credentials on About page | Liability and professional considerations unresolved | |

### Phase 1 (current — quiet sharing)
Friends and a small group of patient families. PWA on GitHub Pages. Local data only. Author anonymous in About page. No formal feedback channel.

### Phase 2 (later — broader sharing)
Custom domain, app store listing, formal author credit, written feedback channel. Possibly a one-page landing site.

### Phase 3 (much later — possibly never)
Cloud, accounts, dietitian dashboard, NHS integration. Stops being a side project. Would need co-founders, funding, or a parent organisation (charity like Matthew's Friends, or a hospital trust).

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
- All seizure-type labels go through `KCCharts.resolveSeizureTypeLabel(seizure, settings)`. Don't reimplement.
- All bucketing for ranges goes through `KCCharts.autoBucketForDays(days)` + the bucketed series builders. The legacy rolling-window functions still exist but aren't used by v1.5+.
- The PDF and XLSX exports are independent — changes to one don't affect the other. Both auto-bucket by range.
- Before adding anything to the **basic Trends** screen, ask: does this serve "parent on the school run wants the headline number"? If not, it probably belongs in **Patterns**.
- Before adding anything to **Patterns**, ask: is this a description of the data, or an inference from it? Only descriptive views are appropriate. Calculated correlations, predictions, or risk scores cross the line.
- Always bump the three version anchors in lockstep when shipping: `CACHE_NAME` in `sw.js`, `APP_VERSION` in `app.js`, About-page version label. Add a "What's new" entry too.
- Local testing: run `python3 -m http.server` in the project folder, open `http://localhost:8000`. SW won't work via `file://`.

---

*Last updated: May 2026 (v1.5.2)*

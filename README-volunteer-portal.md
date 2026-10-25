# Volunteer Plan 2027 — Volunteer Portal

A lightweight, read-only portal styled to align with the supplied Manager dashboard. It uses semantic HTML, CSS custom properties, and Vanilla JavaScript. FullCalendar provides month/list calendar views, Leaflet provides event maps, and downloadable `.ics` files are generated in the browser.

## Files to put in the website root

- `index.html`
- `tokens.css`, `base.css`, `calendar.css` — the shared design system (see Design notes)
- `styles.css` — portal layout, the next-volunteer-day panel (with its hills artwork), weather, directory and filters
- `fonts/NationalTrustTT-Regular.woff2` — typeface
- `app.js`
- `volunteer_plan_2027.json` — exported by the Manager dashboard
- `volunteer-schedule.pdf` — the existing PDF file referenced by the Download PDF Schedule action next to the calendar export button

The JSON and PDF assets are not bundled because they were not included with the supplied Manager source files. If the JSON has not been placed alongside `index.html`, the task directory shows an error state with setup guidance; routine successful loading is kept out of the volunteer UI.

## Run locally

Because the page fetches JSON asynchronously, serve the folder over HTTP or HTTPS instead of opening `index.html` directly with a `file://` URL. For example, from the root folder run:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

The page uses CDN-hosted FullCalendar, Leaflet and Lucide assets, OpenStreetMap tiles, and Nominatim for geocoding location names that are not pre-mapped. These features need an internet connection. The three named North Devon localities Brownsham, Peppercombe and East Titchberry have approximate map coordinates; other locations use geocoding when a volunteer opens an event.

## Supported event fields

The application consumes an array of event objects with `id`, `title`, `start`, optional `end`, optional `allDay`, and `extendedProps` fields including `location`, `description`, `equipment` and `difficulty`. Difficulty values are `Easy`, `Moderate`, and `Strenuous`. For all-day events the modal displays `All day`, and the calendar export creates an all-day iCalendar event with an exclusive end date.

## Design notes (redesign)

Both apps (this planner and the volunteer portal) share one small design system: `tokens.css` (all variables), `base.css` (type, buttons, fields, chips, modal, cards, motion) and `calendar.css` (FullCalendar theme). These three files are **identical in both folders** — edit one, copy to the other. Each app's own `styles.css` only holds page layout.

**Palette (light / dark)** — all in `tokens.css` (`:root` = light, `html.dark` = dark)

| Role | Light | Dark |
|---|---|---|
| Header / nav | `#ffffff` | `#212121` |
| Page | `#f7f5f5` | `#212121` |
| Cards / surface | `#ffffff` | `#2b2b2b` |
| Dividers | `#dcdcdc` | `#555555` |
| Headings | `#212121` | `#ffffff` |
| Body text | `#212121` | `#e0e0e0` |
| Muted / nav text | `#595959` | `#bdbdbd` |
| Accent (buttons, links) | `#00793e` (white text, AA) | `#4cc38a` (dark text, AA) |
| Hero banner | `#005a30` | `#033d25` |

Difficulty colours (`--easy-*`, `--moderate-*`, `--strenuous-*`) are tinted background + dark text + edge colour, AA in both themes.

**Typeface**: *National Trust TT* (Regular, 400 only) was extracted from the base64 data in `nt-font.js` and saved as `fonts/NationalTrustTT-Regular.woff2`, loaded with `@font-face` in `tokens.css` (`--font-display`, falling back to Georgia / serif). It is used for headings and numerals; body and controls use the system sans stack (`--font-body`) because the font has no bold or italic. `nt-font.js` itself is unchanged and still feeds the PDF export. **Licence caveat:** the font's licence states it is for exclusive use by the National Trust — confirm permission before distributing this app, or swap `--font-display` and the `@font-face` for another font.

**Shape**: one radius, `--radius: 8px`, for cards, inputs, buttons, chips, modals and the calendar. `--radius-sm: 4px` is for badges only; `--radius-full: 50%` is for true circles (dots, the brand mark).

**Spacing and type scale**: `--space-1…12` (4 / 8 / 12 / 16 / 24 / 32 / 48 px), `--control-h: 44px`, `--text-xs…2xl`, shadows `--shadow-1…3`, layers `--z-*`.

**Motion**: `--dur-fast` 120ms, `--dur` 220ms, `--dur-slow` 480ms, `--ease`, `--ease-inout`, `--stagger` 70ms. Used for the page-load stagger (`.reveal`, with `--i` as the order), theme cross-fade (`html.theme-fade`), button/card hover and press, calendar month fade, modal scale + fade, chip/segment selection, animated focus ring and the hero artwork drift. Everything is switched off under `prefers-reduced-motion`.

**Calendar**: events are flat cards — surface background, 1px divider border, 8px radius, a small difficulty dot (same colours as the legend), title in the heading font, location in muted text. Every week row has the same fixed height (`--cal-row` in `calendar.css`: 128px desktop, 92px mobile); each day shows one event and the rest collapse into a "+N more" popover (`dayMaxEvents` in the app's JS), so rows never grow when a task is added.

**Task directory**: one task per full-width row — date | title, description, difficulty badge and equipment | action button — stacking to one column on mobile.

**Task detail modal**: same header, sections-with-markers and footer pattern as the planner's task editor (icons instead of step numbers, one primary button).

**Where to tweak**: change a colour, radius, spacing or motion value in `tokens.css`; shared components in `base.css`; calendar in `calendar.css`.

Accessibility: AA text contrast in both themes, visible animated focus rings, skip link, keyboard-operable chips and segmented control, focus trap and Esc in dialogs, `prefers-reduced-motion` respected.

**Next volunteer day panel**: replaces the old hero banner and summary card. `renderNextDay()` in `app.js` picks the first day on or after today from the JSON (days are grouped, so a busy day lists "Also this day"). Its band (the old hills and sun artwork, now short) holds the date, a countdown pill ("Today", "Tomorrow", "in 12 days"), time or "All day", location and difficulty. Below are the description, equipment chips, weather, a map, actions and a **Then coming up** list of the next 2 to 3 days that opens their detail modals. On mobile the order is info, weather, map, actions, coming up, with a fixed 240 px map (300 px on desktop) and 44 px tap targets. If no day is upcoming it shows the most recent day, labelled "Most recent volunteer day" (no weather, no coming-up list). If the file is empty it shows a friendly "No volunteer days yet" message. The panel reveals with the shared `.reveal` stagger and honours `prefers-reduced-motion`.

**Map and directions**: the panel reuses the same Leaflet / OpenStreetMap / Nominatim code and in-memory geocode cache as the detail modal (`mountLocationMap`). The panel map does not capture one-finger drags on touch screens, so the page still scrolls. **Get directions** opens `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` (no key); **Apple Maps** (`maps.apple.com/?daddr=`) and **OpenStreetMap** (`openstreetmap.org/directions?to=`) are the alternatives. If the location cannot be geocoded, the links fall back to a place-name search. The coordinates button copies `lat, lng`. **Add to calendar** downloads an `.ics` for that day (same builder as the detail modal). **Share** uses `navigator.share` where available, otherwise copies the link to the clipboard. **Add all dates to my calendar** moved to the row above the calendar.

**Weather** (Open-Meteo, free, no API key, CORS enabled, so it works from GitHub Pages):

- Forecast: `GET https://api.open-meteo.com/v1/forecast?latitude=&longitude=&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset,precipitation_probability_max,wind_gusts_10m_max&timezone=GMT&wind_speed_unit=mph&start_date=<day>&end_date=<day>`. Used when the day is within 15 days (today to today + 14). Shows an icon from the WMO code, high and low, rain chance and amount, wind and gusts, and sunrise and sunset.
- Further out: shows "Forecast available from <date>", plus typical conditions: `GET https://archive-api.open-meteo.com/v1/archive` (same fields, without probability and gusts) for the same week last year (the day plus or minus 3). It is labelled "Not a forecast" with the dates it covers.
- Times are requested in `GMT` and converted to UK time per date, because Open-Meteo applies today's UTC offset to every date, which is wrong for dates across a clock change.
- A practical line is added from the data: waterproofs if the rain chance is over 50% (or 2 mm or more is forecast, or most of last year's week was wet), a cold note at a high of 6 degrees C or below, a warm note at 24 or above, a wind note for gusts of 35 mph or more, and a dusk warning if sunset is 17:00 or earlier (at most 3 tips).
- Cached in `localStorage` (`vp-wx:*`, with a timestamp): forecasts 3 hours, archive data 30 days; entries older than 30 days are removed. If the network fails a saved copy is shown, labelled as such. If there is nothing saved the weather block is hidden. Weather never blocks the page: it loads after the panel, with an 8 second timeout.
- To preview a different "today", add `?today=YYYY-MM-DD` to the address (for example `index.html?today=2027-01-01`). It changes the countdown, the next-day choice and the forecast window, and shows a "Preview" chip. Nothing else is changed, and the JSON is not modified. The live forecast API only serves real dates, so previews beyond the real window show the out-of-window state or an empty block.

## Deploying to GitHub Pages

The portal is static, read-only, and uses only relative URLs, so it works from a project sub-path such as `https://<user>.github.io/<repo>/`. It needs https (GitHub Pages provides it) for the clipboard and share buttons.

1. Upload `index.html`, `tokens.css`, `base.css`, `calendar.css`, `styles.css`, `app.js`, `volunteer_plan_2027.json` and `fonts/`.
2. Add `volunteer-schedule.pdf` next to `index.html`. It is not in this folder, so the **Download PDF Schedule** link (`./volunteer-schedule.pdf`) is dead until you add it.
3. Re-export the JSON from the planner whenever the schedule changes and replace `volunteer_plan_2027.json`; the page fetches it with `cache: 'no-store'`.
4. In the repository settings, choose **Settings, Pages**, then deploy from a branch and select the folder that holds `index.html`.
5. File names are case-sensitive on GitHub Pages: keep `fonts/NationalTrustTT-Regular.woff2` and `volunteer_plan_2027.json` exactly as written.
6. Third-party services need no keys: FullCalendar and Lucide (jsDelivr CDN), Leaflet (unpkg), OpenStreetMap tiles, Nominatim, Open-Meteo.

**Font licence caveat**: *National Trust TT* is a proprietary National Trust typeface. Publishing the `.woff2` (or `nt-font.js`, which embeds the same font as base64) on a public site redistributes it, so confirm you are licensed to serve it publicly before you deploy. If not, delete `fonts/` (and `nt-font.js` for the planner); `--font-display` falls back to Georgia / serif, and the layout does not depend on the font. `nt-font.js` and the `.woff2` are separate copies, so removing one does not affect the other.

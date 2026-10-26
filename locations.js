/* Shared site list: the fixed default meeting point (usually the carpark) for each preset site.
 *
 * This file is IDENTICAL in the planner and the volunteer portal. Edit one, copy it to the other.
 * It is a plain script (no modules, no network, no API key), loaded before the app's own script:
 *   <script src="./locations.js"></script>
 *
 * Site names must match the task `location` values in the JSON exactly (matching ignores case and
 * surrounding spaces). Custom sites ('Other', e.g. Explorer Days) are not listed and have no default meeting point.
 *
 * Data format: a task may carry an OPTIONAL `extendedProps.meeting` = { label, lat, lon }.
 * It is written by the planner only when the manager picks a point other than the site's default.
 * Absent = use the site default below; no default either = the portal geocodes the location name.
 */
(function () {
  'use strict';

  /** Site name -> { meeting: { label, lat, lon } } (no `meeting` = no fixed meeting point). */
  const VOL_SITES = {
    'Brownsham': { meeting: { label: 'Brownsham carpark', lat: 51.00763027704583, lon: -4.444884902036583 } },
    'Peppercombe': { meeting: { label: 'Peppercombe top gate', lat: 50.985742452056996, lon: -4.303601285349563 }, parking: { label: 'Peppercombe carpark', lat: 50.98651107740936, lon: -4.298244002797727 } },
    'East Titchberry': { meeting: { label: 'East Titchberry carpark', lat: 51.01568848328351, lon: -4.5044983687205615 } },
    'Dunsland': { meeting: { label: 'Dunsland carpark', lat: 50.82474155365349, lon: -4.2505402965918115 } },
    'Bucks Mills': { meeting: { label: 'Bucks Mills carpark', lat: 50.98514660818071, lon: -4.340806973497299 } },
    'Abbotsham': { meeting: { label: 'Abbotsham road parking', lat: 51.024178417989965, lon: -4.2587457615203945 } },
    'Burrough Farm': { meeting: { label: 'Burrough Farm yard', lat: 51.03986450869874, lon: -4.201921379911131 } },
    // The carpark for Kipling Tors is the Westward Ho! one, but the site is called Kipling Tors.
    'Kipling Tors': { meeting: { label: 'Kipling Tors carpark', lat: 51.039322513640236, lon: -4.250517019508731 } },
    'Brixton Barton': { meeting: { label: 'Brixton Barton', lat: 50.83326256454604, lon: -3.984860641113277 } },
    'Welcombe': { meeting: { label: 'Welcombe carpark', lat: 50.933554756706904, lon: -4.544712575441805 } }
  };

  /** Label used when a manager drops a pin but does not name the spot. */
  const DEFAULT_LABEL = 'Meeting point';

  /** Validate a stored `meeting` value; returns a clean { label, lat, lon } or null. */
  function clean(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (raw.lat === null || raw.lon === null || raw.lat === '' || raw.lon === '') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { label: String(raw.label ?? '').trim() || DEFAULT_LABEL, lat, lon };
  }

  /** The preset site for a location name (or null for 'Other' / unknown names). */
  function siteFor(location) {
    const key = String(location ?? '').trim().toLocaleLowerCase();
    const name = Object.keys(VOL_SITES).find((candidate) => candidate.toLocaleLowerCase() === key);
    return name ? { name, ...VOL_SITES[name] } : null;
  }

  /**
   * Where a task meets: its own `meeting` if valid, else the site's default, else null.
   * Returns { label, lat, lon, isDefault } so callers can tell a custom point from the carpark.
   */
  function meetingFor(location, meeting) {
    const own = clean(meeting);
    if (own) return { ...own, isDefault: false };
    const site = siteFor(location);
    return site && site.meeting ? { ...site.meeting, isDefault: true } : null;
  }

  window.VOL_SITES = VOL_SITES;
  window.VOL_MEETING = { DEFAULT_LABEL, clean, siteFor, meetingFor };
})();

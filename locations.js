/* Shared site list: where volunteers PARK (the carpark) for each preset site, and any default meeting point.
 *
 * This file is IDENTICAL in the planner and the volunteer portal. Edit one, copy it to the other.
 * It is a plain script (no modules, no network, no API key), loaded before the app's own script:
 *   <script src="./locations.js"></script>
 *
 * Site names must match the task `location` values in the JSON exactly (matching ignores case and
 * surrounding spaces). Custom sites ('Other', e.g. Explorer Days) are not listed: the manager sets
 * their parking point on the map, or the portal looks the name up.
 *
 * Model: a task's `location` ("Where is it?") is the place volunteers PARK. Directions always go there.
 * The MEETING point is separate and always defaults to the parking, except where a site lists its own
 * default `meeting` below (Peppercombe: the top gate).
 *
 * Data format (both optional, both written by the planner only when they differ from the default):
 *   extendedProps.parking = { label, lat, lon }   a parking point other than the site's carpark
 *                                                 (always set for a custom 'Other' location)
 *   extendedProps.meeting = { label, lat, lon }   a meeting point other than the site's default
 * Absent = use the site default below; no default either = the portal geocodes the location name.
 * Older files that only carry `meeting` keep working: it is simply a custom meeting point.
 */
(function () {
  'use strict';

  /**
   * Site name -> { parking: { label, lat, lon }, meeting?: { label, lat, lon } }.
   * `parking` is the carpark. `meeting` is only listed when the default meeting point is NOT the parking.
   */
  const VOL_SITES = {
    'Brownsham': { parking: { label: 'Brownsham carpark', lat: 51.00763027704583, lon: -4.444884902036583 } },
    'Peppercombe': {
      parking: { label: 'Peppercombe carpark', lat: 50.98651107740936, lon: -4.298244002797727 },
      meeting: { label: 'Peppercombe top gate', lat: 50.985742452056996, lon: -4.303601285349563 }
    },
    'East Titchberry': { parking: { label: 'East Titchberry carpark', lat: 51.01568848328351, lon: -4.5044983687205615 } },
    'Dunsland': { parking: { label: 'Dunsland carpark', lat: 50.82474155365349, lon: -4.2505402965918115 } },
    'Bucks Mills': { parking: { label: 'Bucks Mills carpark', lat: 50.98514660818071, lon: -4.340806973497299 } },
    'Abbotsham': { parking: { label: 'Abbotsham road parking', lat: 51.024178417989965, lon: -4.2587457615203945 } },
    'Burrough Farm': { parking: { label: 'Burrough Farm yard', lat: 51.03986450869874, lon: -4.201921379911131 } },
    // The carpark for Kipling Tors is the Westward Ho! one, but the site is called Kipling Tors.
    'Kipling Tors': { parking: { label: 'Seafield carpark', lat: 51.039322513640236, lon: -4.250517019508731 } },
    'Brixton Barton': { parking: { label: 'Brixton Barton', lat: 50.83326256454604, lon: -3.984860641113277 } },
    'Welcombe': { parking: { label: 'Welcombe carpark', lat: 50.933554756706904, lon: -4.544712575441805 } }
  };

  /** Labels used when a manager drops a pin but does not name the spot. */
  const DEFAULT_LABEL = 'Meeting point';
  const DEFAULT_PARKING_LABEL = 'Parking';

  /** Validate a stored point; returns a clean { label, lat, lon } or null. `fallbackLabel` names an unnamed point. */
  function clean(raw, fallbackLabel) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (raw.lat === null || raw.lon === null || raw.lat === '' || raw.lon === '') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { label: String(raw.label ?? '').trim() || fallbackLabel || DEFAULT_LABEL, lat, lon };
  }

  /** Validate a stored `parking` value (unnamed points are called "Parking"). */
  const cleanParking = (raw) => clean(raw, DEFAULT_PARKING_LABEL);

  /** Do two points sit on the same spot (to about 0.1 m)? */
  function samePlace(a, b) {
    return Boolean(a && b) && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
  }

  /** The preset site for a location name (or null for 'Other' / unknown names). */
  function siteFor(location) {
    const key = String(location ?? '').trim().toLocaleLowerCase();
    const name = Object.keys(VOL_SITES).find((candidate) => candidate.toLocaleLowerCase() === key);
    return name ? { name, ...VOL_SITES[name] } : null;
  }

  /**
   * Accepts a site/location name, a task ({ location, parking, meeting }) or a calendar-style event
   * ({ extendedProps: {...} }); returns the plain fields. A second/third argument overrides the stored value.
   */
  function read(subject, own) {
    const source = subject && typeof subject === 'object' ? (subject.extendedProps && typeof subject.extendedProps === 'object' ? subject.extendedProps : subject) : null;
    return {
      location: source ? source.location : subject,
      parking: own && 'parking' in own ? own.parking : source && source.parking,
      meeting: own && 'meeting' in own ? own.meeting : source && source.meeting
    };
  }

  /**
   * Where volunteers park: the task's own `parking` if valid, else the site's carpark, else null.
   * Returns { label, lat, lon, isDefault } (isDefault = the site's own carpark).
   * Call as parkingFor(task) or parkingFor('Brownsham') or parkingFor('Other place', ownParking).
   */
  function parkingFor(subject, ownParking) {
    const fields = read(subject, arguments.length > 1 ? { parking: ownParking } : null);
    const own = cleanParking(fields.parking);
    const site = siteFor(fields.location);
    if (own) return { ...own, isDefault: Boolean(site && samePlace(own, site.parking)) };
    return site ? { ...site.parking, isDefault: true } : null;
  }

  /** The default meeting point of a site: its own `meeting` (Peppercombe top gate), else its carpark. */
  function defaultMeetingFor(location) {
    const site = siteFor(location);
    return site ? { ...(site.meeting || site.parking) } : null;
  }

  /**
   * Where a task meets: its own `meeting` if valid, else the site's default meeting point, else the task's
   * parking point (a custom location), else null. Returns { label, lat, lon, isDefault, atParking }:
   * isDefault = no custom meeting point; atParking = it is the same spot as the parking point.
   * Older call style meetingFor(location, meeting) still works.
   */
  function meetingFor(subject, ownMeeting, ownParking) {
    const overrides = {};
    if (arguments.length > 1) overrides.meeting = ownMeeting;
    if (arguments.length > 2) overrides.parking = ownParking;
    const fields = read(subject, overrides);
    const parking = parkingFor(subject, ...(arguments.length > 2 ? [ownParking] : []));
    const own = clean(fields.meeting);
    let found;
    if (own) found = { ...own, isDefault: false };
    else {
      const site = siteFor(fields.location);
      const fallback = site && site.meeting ? site.meeting : parking;
      found = fallback ? { label: fallback.label, lat: fallback.lat, lon: fallback.lon, isDefault: true } : null;
    }
    if (found) found.atParking = samePlace(found, parking);
    return found;
  }

  /** Both places for a task or site name: { parking, meeting, separate } (separate = they are different spots). */
  function placesFor(subject) {
    const parking = parkingFor(subject);
    const meeting = meetingFor(subject);
    return { parking, meeting, separate: Boolean(parking && meeting && !samePlace(parking, meeting)) };
  }

  const api = { DEFAULT_LABEL, DEFAULT_PARKING_LABEL, clean, cleanParking, samePlace, siteFor, parkingFor, defaultMeetingFor, meetingFor, placesFor };

  window.VOL_SITES = VOL_SITES;
  window.VOL_MEETING = api;   // original name, kept so older code keeps working
  window.VOL_PLACES = api;    // same object under a clearer name
})();
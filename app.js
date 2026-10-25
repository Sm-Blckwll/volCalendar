/* Volunteer Plan 2027 — read-only volunteer portal.
 * Data is read from ./volunteer_plan_2027.json, the Manager export.
 */
'use strict';

const DATA_URL = './volunteer_plan_2027.json';
const DEFAULT_CALENDAR_DATE = '2027-01-01';
const GEO_CACHE = new Map();

let schedule = [];
let calendar = null;
let activeEvent = null;
let map = null;
let nextMap = null;
let nextEvent = null;
let nextCoordsText = '';
let toastTimer = null;
let lastFocusedElement = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ICONS = {
  calendar: '<i data-lucide="calendar-days" aria-hidden="true"></i>',
  pin: '<i data-lucide="map-pin" aria-hidden="true"></i>',
  clock: '<i data-lucide="clock-3" aria-hidden="true"></i>',
  box: '<i data-lucide="package-check" aria-hidden="true"></i>',
  arrow: '<i data-lucide="arrow-up-right" aria-hidden="true"></i>',
  calendarPlus: '<i data-lucide="calendar-plus" aria-hidden="true"></i>'
};

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function normaliseEvent(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Schedule item ${index + 1} is not an event object.`);
  }
  const title = String(raw.title ?? '').trim();
  const start = String(raw.start ?? '').trim();
  if (!title) throw new Error(`Schedule item ${index + 1} is missing a title.`);
  if (!start || Number.isNaN(new Date(start).getTime())) throw new Error(`“${title}” has a missing or invalid start date.`);

  const props = raw.extendedProps && typeof raw.extendedProps === 'object' ? raw.extendedProps : {};
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const allowedDifficulty = ['Easy', 'Moderate', 'Strenuous'];
  const difficultyValue = String(props.difficulty ?? 'Moderate').trim();
  const difficulty = allowedDifficulty.includes(difficultyValue) ? difficultyValue : 'Moderate';
  const event = {
    id: String(raw.id ?? `schedule-item-${index + 1}`),
    title,
    start,
    allDay: typeof raw.allDay === 'boolean' ? raw.allDay : isDateOnly,
    extendedProps: {
      location: String(props.location ?? 'Unspecified location').trim() || 'Unspecified location',
      description: String(props.description ?? '').trim(),
      equipment: String(props.equipment ?? '').trim(),
      difficulty,
      duration: String(props.duration ?? '').trim()
    }
  };
  if (raw.end) event.end = String(raw.end);
  return event;
}

function parseLocalDate(dateValue) {
  if (!dateValue) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue));
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStartDate(event) {
  return parseLocalDate(event.start);
}

function formatDate(value, options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  const date = parseLocalDate(value);
  return date ? new Intl.DateTimeFormat('en-GB', options).format(date) : 'Date to be confirmed';
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function getDuration(event) {
  if (event.allDay) return 'All day';
  if (event.extendedProps.duration) return event.extendedProps.duration;
  if (!event.end) return 'Time not specified';
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 'Time not specified';
  const mins = Math.round((end - start) / 60000);
  const hours = Math.floor(mins / 60);
  const remaining = mins % 60;
  const duration = [hours ? `${hours} hr${hours === 1 ? '' : 's'}` : '', remaining ? `${remaining} min` : ''].filter(Boolean).join(' ');
  const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${duration} (${timeFmt.format(start)}–${timeFmt.format(end)})`;
}

function difficultyClass(value) {
  if (value === 'Easy') return 'easy';
  if (value === 'Strenuous') return 'strenuous';
  return 'moderate';
}

function listEquipment(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? '').split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function initialiseTheme() {
  let stored = null;
  try { stored = localStorage.getItem('volunteer-plan-theme'); } catch (_) { /* Storage is optional. */ }
  const shouldBeDark = stored ? stored === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', Boolean(shouldBeDark));
  updateThemeButton();
  $('#theme-toggle').addEventListener('click', () => {
    fadeThemeChange();
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('volunteer-plan-theme', dark ? 'dark' : 'light'); } catch (_) { /* Theme remains togglable. */ }
    updateThemeButton();
    if (calendar) calendar.updateSize();
  });
}

/** Cross-fade colours briefly while the theme switches (CSS: html.theme-fade). */
function fadeThemeChange() {
  const root = document.documentElement;
  root.classList.add('theme-fade');
  window.clearTimeout(fadeThemeChange.timer);
  fadeThemeChange.timer = window.setTimeout(() => root.classList.remove('theme-fade'), 400);
}

/** Fade the calendar body in whenever the month or view changes (skipped for reduced motion). */
function animateCalendarView() {
  const harness = $('#calendar .fc-view-harness');
  if (!harness || !harness.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  harness.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: parseFloat(token('--dur-slow')) || 480, easing: token('--ease') || 'ease-out' });
}

function updateThemeButton() {
  const dark = document.documentElement.classList.contains('dark');
  const button = $('#theme-toggle');
  button.innerHTML = `${dark ? '<i data-lucide="sun" aria-hidden="true"></i>' : '<i data-lucide="moon" aria-hidden="true"></i>'}<span class="sr-only">Toggle theme</span>`;
  button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  refreshIcons();
}

async function loadSchedule() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('The schedule JSON must contain an array of events.');
    schedule = data.map(normaliseEvent).sort((a, b) => {
      const aTime = getStartDate(a)?.getTime() ?? 0;
      const bTime = getStartDate(b)?.getTime() ?? 0;
      return aTime - bTime || a.title.localeCompare(b.title);
    });
    populateLocationFilter();
    initCalendar();
    renderDirectory();
    $('#download-all-ics').disabled = schedule.length === 0;
    renderNextDay();
  } catch (error) {
    console.error('Volunteer schedule could not be loaded:', error);
    schedule = [];
    populateLocationFilter();
    $('#calendar').innerHTML = '<div class="empty-state"><strong>Schedule unavailable</strong><p>Check the task directory below for instructions on loading the volunteer schedule.</p></div>';
    renderDirectory({ loadError: error });
    $('#download-all-ics').disabled = true;
    renderNextDay();
  }
}

// ---------------------------------------------------------------------------
// Next volunteer day panel
// ---------------------------------------------------------------------------

/** Open-Meteo is free and key-less; the forecast reaches today + 14 days with data. */
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive';
/** Ask for GMT: Open-Meteo applies today's UTC offset to every date, so times are converted per date below. */
const WEATHER_API_TZ = 'GMT';
const DISPLAY_TZ = 'Europe/London';
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: DISPLAY_TZ });
const FORECAST_DAYS = 15;
const WEATHER_CACHE_PREFIX = 'vp-wx:';

/** WMO weather codes → label and Lucide icon. */
function describeWeather(code) {
  const table = [
    [[0], 'Clear sky', 'sun'], [[1], 'Mostly clear', 'sun'], [[2], 'Partly cloudy', 'cloud-sun'], [[3], 'Overcast', 'cloud'],
    [[45, 48], 'Fog', 'cloud-fog'], [[51, 53, 55, 56, 57], 'Drizzle', 'cloud-drizzle'],
    [[61, 63], 'Rain', 'cloud-rain'], [[65, 66, 67], 'Heavy rain', 'cloud-rain-wind'],
    [[71, 73, 75, 77, 85, 86], 'Snow', 'cloud-snow'], [[80, 81, 82], 'Showers', 'cloud-rain'],
    [[95, 96, 99], 'Thunderstorms', 'cloud-lightning']
  ];
  const match = table.find(([codes]) => codes.includes(Number(code)));
  return match ? { label: match[1], icon: match[2] } : { label: 'Mixed conditions', icon: 'cloud' };
}

/** "Today" for the page. `?today=YYYY-MM-DD` previews the panel for another date (harmless in production). */
function getToday() {
  const override = new URLSearchParams(window.location.search).get('today');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(override || '') ? parseLocalDate(override) : null;
  const date = parsed || new Date();
  date.setHours(0, 0, 0, 0);
  return { date, overridden: Boolean(parsed) };
}

const dayKey = (value) => String(value).slice(0, 10);
const toKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Whole calendar days from `from` to `to` (DST-safe). */
function daysBetween(from, to) {
  return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);
}

function countdownLabel(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** Pick the day to feature: the first upcoming one, else the most recent past one. */
function pickNextDay(today) {
  const keys = [...new Set(schedule.map((event) => dayKey(event.start)))].sort();
  const todayKey = toKey(today);
  const upcoming = keys.filter((key) => key >= todayKey);
  const featured = upcoming[0] || keys[keys.length - 1] || null;
  return {
    featured,
    isUpcoming: Boolean(upcoming[0]),
    events: featured ? schedule.filter((event) => dayKey(event.start) === featured) : [],
    later: upcoming.slice(1, 4).map((key) => schedule.find((event) => dayKey(event.start) === key))
  };
}

function setText(selector, value) { $(selector).textContent = value; }

function renderNextDay() {
  const panel = $('.next-day');
  const today = getToday();
  const pick = pickNextDay(today.date);
  panel.setAttribute('aria-busy', 'false');
  nextEvent = null;

  const preview = $('#next-preview');
  preview.hidden = !today.overridden;
  if (today.overridden) preview.textContent = `Preview: today is ${formatDate(toKey(today.date), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  if (!pick.featured) {
    panel.dataset.state = 'empty';
    setText('#next-heading', 'Next volunteer day');
    setText('#next-title', schedule.length ? 'No dates to show' : 'No volunteer days yet');
    setText('#next-date', '');
    $('#next-countdown').hidden = true;
    $('#next-meta').hidden = true;
    const note = $('#next-note');
    note.hidden = false;
    note.textContent = 'Volunteer days will appear here as soon as they are scheduled. Check back soon.';
    return;
  }

  const event = pick.events[0];
  const props = event.extendedProps;
  const days = daysBetween(today.date, parseLocalDate(pick.featured));
  nextEvent = event;
  panel.dataset.state = pick.isUpcoming ? 'upcoming' : 'past';
  setText('#next-heading', pick.isUpcoming ? 'Next volunteer day' : 'Most recent volunteer day');
  setText('#next-title', event.title);
  setText('#next-date', formatDate(event.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const countdown = $('#next-countdown');
  countdown.hidden = false;
  countdown.textContent = countdownLabel(days);
  $('#next-meta').hidden = false;
  setText('#next-location', props.location);
  setText('#next-time', event.allDay ? 'All day' : getDuration(event));
  const badge = $('#next-difficulty');
  badge.className = `difficulty-badge badge-${difficultyClass(props.difficulty)}`;
  badge.textContent = props.difficulty;
  const note = $('#next-note');
  note.hidden = pick.isUpcoming;
  note.textContent = pick.isUpcoming ? '' : 'There are no upcoming volunteer days in the schedule yet, so this is the most recent one.';

  setText('#next-description', props.description || 'No description provided for this task.');
  const equipment = listEquipment(props.equipment);
  const equipmentBox = $('#next-equipment');
  equipmentBox.replaceChildren();
  if (!equipment.length) {
    equipmentBox.innerHTML = '<span class="muted-copy">No equipment listed.</span>';
  } else {
    equipment.forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'equipment-chip';
      chip.innerHTML = `<i data-lucide="check-circle-2" aria-hidden="true"></i><span>${escapeHTML(item)}</span>`;
      equipmentBox.appendChild(chip);
    });
  }

  // Other tasks on the same day.
  const also = $('#next-also');
  also.hidden = pick.events.length < 2;
  also.replaceChildren();
  if (pick.events.length > 1) {
    const label = document.createElement('span');
    label.textContent = 'Also this day:';
    also.appendChild(label);
    pick.events.slice(1).forEach((other) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-link text-button';
      button.textContent = `${other.title} · ${other.extendedProps.location}`;
      button.addEventListener('click', () => openEventModal(other));
      also.appendChild(button);
    });
  }

  // Then coming up.
  const list = $('#coming-list');
  list.replaceChildren();
  pick.later.forEach((later) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'coming-item';
    button.setAttribute('aria-label', `${later.title}, ${formatDate(later.start)}, ${later.extendedProps.location}. View details`);
    button.innerHTML = `<span class="coming-date">${escapeHTML(formatDate(later.start, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><span class="coming-title">${escapeHTML(later.title)}</span><span class="coming-place">${escapeHTML(later.extendedProps.location)}</span>`;
    button.addEventListener('click', () => openEventModal(later));
    item.appendChild(button);
    list.appendChild(item);
  });
  $('#next-upcoming').hidden = pick.later.length === 0;

  const weatherBox = $('#next-weather');
  weatherBox.hidden = true;
  weatherBox.replaceChildren();
  refreshIcons();
  loadNextDayPlace(event, days, pick.isUpcoming);
}

/** Geocode once, then draw the map, links and weather; none of this blocks the rest of the page. */
async function loadNextDayPlace(event, days, isUpcoming) {
  const location = event.extendedProps.location;
  const isCurrent = () => nextEvent === event;
  const previous = nextMap;
  nextMap = null;
  const draggable = !(window.L && window.L.Browser && window.L.Browser.mobile);
  const result = await mountLocationMap($('#next-map'), location, previous, isCurrent, { dragging: draggable });
  if (!isCurrent()) return;
  nextMap = result.map;
  const coords = result.coords;
  const links = mapLinks(coords, location);
  $('#next-directions').href = links.google;
  $('#next-directions-apple').href = links.apple;
  const osm = $('#next-directions-osm');
  osm.hidden = !links.osm;
  if (links.osm) osm.href = links.osm;
  const copy = $('#next-copy-coords');
  copy.hidden = !coords;
  if (coords) {
    nextCoordsText = `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`;
    setText('#next-coords', nextCoordsText);
    copy.setAttribute('aria-label', `Copy coordinates ${nextCoordsText}`);
  }
  if (coords && isUpcoming) {
    renderWeather(event, coords, days).catch((error) => console.warn('Weather unavailable:', error));
  }
}

// ---- Weather (Open-Meteo, cached, never blocks the page) ----

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
}

function writeCache(key, data) {
  try {
    const cutoff = Date.now() - 30 * 86400000;
    Object.keys(localStorage).filter((name) => name.startsWith(WEATHER_CACHE_PREFIX)).forEach((name) => {
      const entry = readCache(name);
      if (!entry || entry.t < cutoff) localStorage.removeItem(name);
    });
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch (_) { /* Caching is optional. */ }
}

async function fetchWeather(url) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 400) return { outOfRange: true };
    if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

/** Cached fetch: fresh cache first, then the network, then a stale copy if offline. */
async function cachedWeather(key, url, maxAgeMs) {
  const cached = readCache(key);
  if (cached && Date.now() - cached.t < maxAgeMs) return { data: cached.data, t: cached.t, stale: false };
  try {
    const data = await fetchWeather(url);
    if (!data.outOfRange) writeCache(key, data);
    return { data, t: Date.now(), stale: false };
  } catch (error) {
    if (cached) return { data: cached.data, t: cached.t, stale: true };
    throw error;
  }
}

const DAILY_FIELDS = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset';

function weatherUrl(base, coords, start, end, fields = DAILY_FIELDS) {
  return `${base}?latitude=${coords.lat.toFixed(4)}&longitude=${coords.lon.toFixed(4)}&daily=${fields}&timezone=${WEATHER_API_TZ}&wind_speed_unit=mph&start_date=${start}&end_date=${end}`;
}

/** Turn an Open-Meteo `daily` block into an array of plain day objects. */
function readDays(data) {
  const daily = data && data.daily;
  if (!daily || !Array.isArray(daily.time)) return [];
  return daily.time.map((time, index) => {
    const pick = (name) => (Array.isArray(daily[name]) ? daily[name][index] : null);
    return {
      date: time,
      code: pick('weather_code'),
      high: pick('temperature_2m_max'),
      low: pick('temperature_2m_min'),
      rainChance: pick('precipitation_probability_max'),
      rain: pick('precipitation_sum'),
      wind: pick('wind_speed_10m_max'),
      gust: pick('wind_gusts_10m_max'),
      sunrise: pick('sunrise'),
      sunset: pick('sunset')
    };
  });
}

/** Open-Meteo returns UTC times ("2027-01-06T08:19"); show them as UK local time for that date. */
const timeOf = (iso) => (iso ? timeFormat.format(new Date(`${iso}Z`)) : '');
const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value) => Math.round(value);

async function renderWeather(event, coords, days) {
  const box = $('#next-weather');
  const eventDate = parseLocalDate(dayKey(event.start));
  const key = `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`;
  const location = event.extendedProps.location;
  const isCurrent = () => nextEvent === event;
  const availableFrom = new Date(eventDate);
  availableFrom.setDate(availableFrom.getDate() - (FORECAST_DAYS - 1));
  const dateKey = dayKey(event.start);

  // 1. Inside the forecast window: the real forecast for that day and place.
  if (days <= FORECAST_DAYS - 1) {
    const forecastUrl = weatherUrl(WEATHER_API, coords, dateKey, dateKey, `${DAILY_FIELDS},precipitation_probability_max,wind_gusts_10m_max`);
    let forecast = null;
    try {
      forecast = await cachedWeather(`${WEATHER_CACHE_PREFIX}f:${key}:${dateKey}`, forecastUrl, 3 * 3600000);
    } catch (error) {
      console.warn('Forecast request failed:', error);
    }
    if (!isCurrent()) return;
    const day = forecast && !forecast.data.outOfRange ? readDays(forecast.data)[0] : null;
    if (day && hasNumber(day.high) && day.code !== null) {
      box.innerHTML = forecastMarkup(day, location, forecast);
      box.hidden = false;
      refreshIcons();
      return;
    }
    // The forecast does not cover this day yet (or the service is unreachable): fall through.
    if (!forecast) return; // Offline with nothing cached: hide the block.
  }

  // 2. Too far ahead: be honest, and show last year's conditions for the same week as a guide.
  box.innerHTML = outsideMarkup(availableFrom, null, location);
  box.hidden = false;
  refreshIcons();
  try {
    const lastYear = new Date(eventDate);
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    const from = new Date(lastYear); from.setDate(from.getDate() - 3);
    const to = new Date(lastYear); to.setDate(to.getDate() + 3);
    const archive = await cachedWeather(`${WEATHER_CACHE_PREFIX}a:${key}:${toKey(from)}`, weatherUrl(WEATHER_ARCHIVE_API, coords, toKey(from), toKey(to)), 30 * 86400000);
    if (!isCurrent()) return;
    const week = readDays(archive.data).filter((day) => hasNumber(day.high) && hasNumber(day.low));
    if (week.length >= 4) {
      box.innerHTML = outsideMarkup(availableFrom, { week, lastYear, from, to }, location);
      refreshIcons();
    }
  } catch (error) {
    console.warn('Typical conditions unavailable:', error);
  }
}

function statMarkup(icon, label, value) {
  return `<div class="stat"><i data-lucide="${icon}" aria-hidden="true"></i><div><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div></div>`;
}

/** Short, practical advice from the numbers (empty when nothing stands out). */
function practicalTips({ rainChance, rain, high, gust, wind, sunset, rainyDays, days }) {
  const tips = [];
  const wet = (hasNumber(rainChance) && rainChance > 50) || (hasNumber(rain) && rain >= 2 && !days) || (days && rainyDays / days >= 0.6);
  if (wet) tips.push(['umbrella', days ? 'Often wet at this time of year, so pack waterproofs.' : 'Rain is likely, so bring waterproofs.']);
  if (hasNumber(high) && high <= 6) tips.push(['snowflake', 'Cold day: wrap up warm and bring gloves and a hat.']);
  else if (hasNumber(high) && high >= 24) tips.push(['sun', 'Warm day: bring water and sun cream.']);
  if ((hasNumber(gust) && gust >= 35) || (hasNumber(wind) && wind >= 30)) tips.push(['wind', 'Strong winds are expected: wear an extra layer.']);
  if (sunset && sunset <= '17:00') tips.push(['sunset', `Sunset at ${sunset}. Plan to finish before dusk.`]);
  return tips.slice(0, 3);
}

function tipsMarkup(tips) {
  if (!tips.length) return '';
  return `<ul class="practical">${tips.map(([icon, text]) => `<li><i data-lucide="${icon}" aria-hidden="true"></i><span>${escapeHTML(text)}</span></li>`).join('')}</ul>`;
}

function forecastMarkup(day, location, forecast) {
  const info = describeWeather(day.code);
  const stamp = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(forecast.t));
  const rain = [hasNumber(day.rainChance) ? `${round(day.rainChance)}% chance` : '', hasNumber(day.rain) ? `${day.rain.toFixed(1)} mm` : ''].filter(Boolean).join(' · ') || '—';
  const wind = hasNumber(day.wind) ? `${round(day.wind)} mph${hasNumber(day.gust) ? `, gusts ${round(day.gust)}` : ''}` : '—';
  const tips = practicalTips({ rainChance: day.rainChance, rain: day.rain, high: day.high, gust: day.gust, wind: day.wind, sunset: timeOf(day.sunset) });
  return `
    <h2 class="block-title">Weather</h2>
    <div class="weather-head">
      <span class="weather-icon"><i data-lucide="${info.icon}" aria-hidden="true"></i></span>
      <div><p class="weather-main">${escapeHTML(info.label)}</p><p class="weather-temp">${round(day.high)}° / ${round(day.low)}°C</p></div>
    </div>
    <div class="stats">
      ${statMarkup('droplets', 'Rain', escapeHTML(rain))}
      ${statMarkup('wind', 'Wind', escapeHTML(wind))}
      ${statMarkup('sunrise', 'Sunrise', escapeHTML(timeOf(day.sunrise) || '—'))}
      ${statMarkup('sunset', 'Sunset', escapeHTML(timeOf(day.sunset) || '—'))}
    </div>
    ${tipsMarkup(tips)}
    <p class="weather-source">Forecast for ${escapeHTML(location)} · Open-Meteo · updated ${escapeHTML(stamp)}${forecast.stale ? ' (saved copy, you may be offline)' : ''}</p>`;
}

function outsideMarkup(availableFrom, typical, location) {
  const from = formatDate(toKey(availableFrom), { weekday: 'short', day: 'numeric', month: 'short' });
  let extra = '';
  if (typical) {
    const { week, lastYear, from: start, to: end } = typical;
    const highs = week.map((day) => day.high);
    const lows = week.map((day) => day.low);
    const wetDays = week.filter((day) => hasNumber(day.rain) && day.rain >= 1).length;
    const middle = week.find((day) => day.date === toKey(lastYear)) || week[Math.floor(week.length / 2)];
    const range = `${formatDate(toKey(start), { day: 'numeric', month: 'short' })} – ${formatDate(toKey(end), { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const sunset = timeOf(middle.sunset);
    const tips = practicalTips({ high: Math.max(...highs), rainyDays: wetDays, days: week.length, sunset });
    extra = `
      <div class="stats">
        ${statMarkup('thermometer', 'Typical high / low', `${round(Math.min(...highs))}–${round(Math.max(...highs))}° / ${round(Math.min(...lows))}–${round(Math.max(...lows))}°C`)}
        ${statMarkup('droplets', 'Wet days', `${wetDays} of ${week.length}`)}
        ${statMarkup('sunrise', 'Sunrise', escapeHTML(timeOf(middle.sunrise) || '—'))}
        ${statMarkup('sunset', 'Sunset', escapeHTML(sunset || '—'))}
      </div>
      ${tipsMarkup(tips)}
      <p class="weather-source">Not a forecast. This is what ${escapeHTML(location)} saw last year, ${escapeHTML(range)} (Open-Meteo archive).</p>`;
  }
  return `
    <h2 class="block-title">Weather</h2>
    <div class="weather-head">
      <span class="weather-icon"><i data-lucide="calendar-clock" aria-hidden="true"></i></span>
      <div><p class="weather-main">Forecast available from ${escapeHTML(from)}</p><p class="weather-temp weather-temp-muted">Forecasts only reach about two weeks ahead.</p></div>
    </div>${extra}`;
}

// ---- Share, copy, calendar ----

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { /* Not supported. */ }
    area.remove();
    return copied;
  }
}

async function shareNextDay() {
  if (!nextEvent) return;
  const props = nextEvent.extendedProps;
  const url = `${window.location.origin}${window.location.pathname}`;
  const text = `Volunteer day: ${nextEvent.title} at ${props.location}, ${formatDate(nextEvent.start, { weekday: 'long', day: 'numeric', month: 'long' })}.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Volunteer Plan 2027', text, url });
    } catch (error) {
      if (error && error.name !== 'AbortError') showToast('Sharing was not possible on this device.');
    }
    return;
  }
  showToast(await copyText(`${text} ${url}`) ? 'Link copied to the clipboard' : 'Could not copy the link');
}

function populateLocationFilter() {
  const select = $('#location-filter');
  const current = select.value;
  const locations = [...new Set(schedule.map((event) => event.extendedProps.location).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.replaceChildren(new Option('All locations', ''));
  locations.forEach((location) => select.add(new Option(location, location)));
  if (locations.includes(current)) select.value = current;
}

function initCalendar() {
  const calendarElement = $('#calendar');
  if (calendar) calendar.destroy();
  if (!window.FullCalendar) {
    calendarElement.innerHTML = '<div class="empty-state"><strong>Calendar library unavailable</strong><p>Check your connection and reload the page.</p></div>';
    return;
  }
  calendar = new FullCalendar.Calendar(calendarElement, {
    initialDate: DEFAULT_CALENDAR_DATE,
    initialView: window.matchMedia('(max-width: 640px)').matches ? 'listMonth' : 'dayGridMonth',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
    buttonText: { today: 'Today', month: 'Month', list: 'List' },
    firstDay: 1,
    height: 'auto',
    dayMaxEvents: 1,
    navLinks: false,
    nowIndicator: true,
    events: schedule.map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      ...(event.end ? { end: event.end } : {}),
      allDay: event.allDay,
      extendedProps: { ...event.extendedProps, sourceEventId: event.id }
    })),
    datesSet: animateCalendarView,
    eventClassNames(arg) { return [`event-${difficultyClass(arg.event.extendedProps.difficulty)}`]; },
    eventContent(arg) {
      const wrapper = document.createElement('div');
      wrapper.className = `fc-event-content event-${difficultyClass(arg.event.extendedProps.difficulty)}`;
      const title = document.createElement('span');
      title.className = 'fc-event-title-custom';
      title.textContent = arg.event.title;
      const location = document.createElement('span');
      location.className = 'fc-event-location';
      location.textContent = arg.event.extendedProps.location || 'Location TBC';
      wrapper.append(title, location);
      return { domNodes: [wrapper] };
    },
    eventClick(info) {
      info.jsEvent.preventDefault();
      const event = schedule.find((item) => item.id === info.event.id) || schedule.find((item) => item.id === info.event.extendedProps.sourceEventId);
      if (event) openEventModal(event);
    },
    dateClick(info) {
      const matching = schedule.filter((event) => (event.start.slice(0, 10) === info.dateStr.slice(0, 10)));
      if (matching.length === 1) openEventModal(matching[0]);
      else if (matching.length > 1) showToast(`${matching.length} tasks are scheduled on this date. Select a task in the calendar or list.`);
    },
    eventDidMount(info) {
      info.el.setAttribute('aria-label', `${info.event.title}, ${info.event.extendedProps.location || 'location to be confirmed'}, ${info.event.extendedProps.difficulty || 'Moderate'}`);
      info.el.title = `${info.event.title} · ${info.event.extendedProps.location || 'Location TBC'}`;
    }
  });
  calendar.render();
}

function filteredEvents() {
  const query = $('#task-search').value.trim().toLocaleLowerCase();
  const location = $('#location-filter').value;
  const difficulty = $('#difficulty-filter').value;
  return schedule.filter((event) => {
    const props = event.extendedProps;
    const matchesLocation = !location || props.location === location;
    const matchesDifficulty = !difficulty || props.difficulty === difficulty;
    const searchable = [event.title, props.location, props.description, props.equipment, props.difficulty, formatDate(event.start)].join(' ').toLocaleLowerCase();
    return matchesLocation && matchesDifficulty && (!query || searchable.includes(query));
  });
}

function renderDirectory(options = {}) {
  const container = $('#task-directory');
  container.replaceChildren();
  if (options.loadError) {
    const errorState = document.createElement('div');
    errorState.className = 'empty-state';
    errorState.innerHTML = '<span class="empty-icon"><i data-lucide="file-warning" aria-hidden="true"></i></span><p><strong>Schedule not available</strong><br>Check that <code>volunteer_plan_2027.json</code> exists beside <code>index.html</code> and that the page is being served over HTTP.</p>';
    container.appendChild(errorState);
    $('#directory-result-count').textContent = 'Unable to load tasks';
    refreshIcons();
    return;
  }
  const items = filteredEvents();
  $('#directory-result-count').textContent = `${items.length} ${items.length === 1 ? 'task' : 'tasks'}${items.length !== schedule.length ? ` of ${schedule.length}` : ''}`;
  if (!schedule.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span class="empty-icon"><i data-lucide="calendar-clock" aria-hidden="true"></i></span><p><strong>No scheduled tasks yet</strong><br>Tasks will appear here when the Manager dashboard exports a schedule.</p>';
    container.appendChild(empty);
    refreshIcons();
    return;
  }
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span class="empty-icon"><i data-lucide="search-x" aria-hidden="true"></i></span><p><strong>No tasks match those filters</strong><br>Try a different search term or clear one of the filters.</p>';
    container.appendChild(empty);
    refreshIcons();
    return;
  }

  const groups = new Map();
  items.forEach((event) => {
    const location = event.extendedProps.location || 'Unspecified location';
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location).push(event);
  });
  [...groups.keys()].sort((a, b) => a.localeCompare(b)).forEach((location) => {
    const group = document.createElement('section');
    group.className = 'location-group';
    const heading = document.createElement('header');
    heading.className = 'location-group-header';
    heading.innerHTML = `<div class="location-heading"><i data-lucide="map-pin" aria-hidden="true"></i><h3>${escapeHTML(location)}</h3></div><span class="location-count">${groups.get(location).length} ${groups.get(location).length === 1 ? 'task' : 'tasks'}</span>`;
    const list = document.createElement('div');
    list.className = 'location-task-list';
    groups.get(location).sort((a, b) => (getStartDate(a)?.getTime() ?? 0) - (getStartDate(b)?.getTime() ?? 0)).forEach((event) => list.appendChild(createTaskCard(event)));
    group.append(heading, list);
    container.appendChild(group);
  });
  refreshIcons();
}

function createTaskCard(event) {
  const props = event.extendedProps;
  const card = document.createElement('article');
  card.className = 'task-card';
  const main = document.createElement('div');
  main.className = 'task-card-main';
  const date = document.createElement('div');
  date.className = 'task-date';
  date.innerHTML = `${ICONS.calendar}<span>${escapeHTML(formatDate(event.start))}${event.allDay ? ' · All day' : ''}</span>`;
  const title = document.createElement('h4');
  title.textContent = event.title;
  const description = document.createElement('p');
  description.className = 'task-card-description';
  description.textContent = props.description || 'No task description provided.';
  const meta = document.createElement('div');
  meta.className = 'task-card-meta';
  const badge = document.createElement('span');
  badge.className = `difficulty-badge badge-${difficultyClass(props.difficulty)}`;
  badge.textContent = props.difficulty;
  meta.appendChild(badge);
  const equipmentCount = listEquipment(props.equipment).length;
  const equipment = document.createElement('span');
  equipment.className = 'task-equipment-summary';
  equipment.innerHTML = `${ICONS.box}<span>${equipmentCount ? `${equipmentCount} equipment ${equipmentCount === 1 ? 'item' : 'items'}` : 'Equipment not specified'}</span>`;
  meta.appendChild(equipment);
  main.append(title, description, meta);

  const actions = document.createElement('div');
  actions.className = 'task-card-actions';
  const view = document.createElement('button');
  view.className = 'view-detail-button';
  view.type = 'button';
  view.innerHTML = `View details ${ICONS.arrow}`;
  view.setAttribute('aria-label', `View details for ${event.title}`);
  view.addEventListener('click', () => openEventModal(event));
  actions.appendChild(view);
  card.append(date, main, actions);
  return card;
}

function openEventModal(event) {
  activeEvent = event;
  lastFocusedElement = document.activeElement;
  const props = event.extendedProps;
  $('#modal-title').textContent = event.title;
  $('#modal-date').textContent = `${formatDate(event.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${!event.allDay ? formatTimedRange(event) : ''}`;
  $('#modal-duration').textContent = getDuration(event);
  $('#modal-location').textContent = props.location || 'Location to be confirmed';
  $('#modal-description').textContent = props.description || 'No description provided for this task.';
  const badge = $('#modal-difficulty');
  badge.className = `difficulty-badge badge-${difficultyClass(props.difficulty)}`;
  badge.textContent = props.difficulty || 'Moderate';

  const equipmentContainer = $('#modal-equipment');
  equipmentContainer.replaceChildren();
  const equipment = listEquipment(props.equipment);
  if (!equipment.length) {
    const missing = document.createElement('span');
    missing.className = 'muted-copy';
    missing.textContent = 'No equipment listed.';
    equipmentContainer.appendChild(missing);
  } else {
    equipment.forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'equipment-chip';
      chip.innerHTML = `<i data-lucide="check-circle-2" aria-hidden="true"></i><span>${escapeHTML(item)}</span>`;
      equipmentContainer.appendChild(chip);
    });
  }
  const directions = $('#map-directions');
  directions.hidden = true;
  directions.removeAttribute('href');
  const backdrop = $('#event-modal');
  backdrop.hidden = false;
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('#close-modal').focus();
  refreshIcons();
  renderEventMap(props.location);
  $('#download-event-ics').disabled = false;
}

function formatTimedRange(event) {
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return '';
  const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  let label = ` · ${timeFmt.format(start)}`;
  if (event.end) {
    const end = new Date(event.end);
    if (!Number.isNaN(end.getTime())) label += `–${timeFmt.format(end)}`;
  }
  return label;
}

function closeEventModal() {
  const backdrop = $('#event-modal');
  if (backdrop.hidden) return;
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  activeEvent = null;
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
}

const MAP_FALLBACK = [50.93, -4.35];

/** Direction links for a place; `coords` may be null when it could not be geocoded. */
function mapLinks(coords, location) {
  if (!coords) {
    const query = encodeURIComponent(`${location}, Devon, United Kingdom`);
    return { google: `https://www.google.com/maps/dir/?api=1&destination=${query}`, apple: `https://maps.apple.com/?daddr=${query}&dirflg=d`, osm: null };
  }
  const point = `${coords.lat},${coords.lon}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${point}`,
    apple: `https://maps.apple.com/?daddr=${point}&dirflg=d`,
    osm: `https://www.openstreetmap.org/directions?to=${encodeURIComponent(point)}`
  };
}

/**
 * Draw a Leaflet map for a named place inside `element` (modal and next-day panel share this).
 * `previous` is disposed first; `isCurrent()` lets callers drop results that arrive late.
 * Resolves to { map, coords }.
 */
async function mountLocationMap(element, location, previous, isCurrent, { dragging = true } = {}) {
  // Leaflet owns the element's children, so dispose the old instance before reusing it.
  if (previous) previous.remove();
  element.innerHTML = '<div class="map-placeholder">Finding this location on the map…</div>';
  if (!window.L) {
    element.innerHTML = '<div class="map-placeholder">Map library unavailable. Check your connection and reload the page.</div>';
    return { map: null, coords: null };
  }
  try {
    const coords = await geocodeLocation(location);
    if (!isCurrent()) return { map: null, coords };
    element.innerHTML = '';
    const view = coords ? [coords.lat, coords.lon] : MAP_FALLBACK;
    const instance = L.map(element, { scrollWheelZoom: false, zoomControl: true, attributionControl: false, dragging }).setView(view, coords ? 14 : 10, { animate: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(instance);
    L.control.attribution({ prefix: false }).addTo(instance);
    const icon = L.divIcon({ className: '', html: '<span class="custom-map-marker"><i data-lucide="map-pin" aria-hidden="true"></i></span>', iconSize: [32, 36], iconAnchor: [16, 34] });
    const marker = L.marker(view, { icon }).addTo(instance);
    if (coords) {
      marker.bindPopup(escapeHTML(location));
    } else {
      const notice = document.createElement('div');
      notice.className = 'map-inline-note';
      notice.textContent = `Could not locate “${location}” precisely. Showing the North Devon area; please confirm the site with the volunteer coordinator.`;
      element.appendChild(notice);
    }
    refreshIcons();
    window.setTimeout(() => instance.invalidateSize(true), 80);
    return { map: instance, coords };
  } catch (error) {
    console.warn('Location map could not be loaded:', error);
    if (isCurrent()) element.innerHTML = '<div class="map-placeholder">Map service unavailable right now. The location is listed above.</div>';
    return { map: null, coords: null };
  }
}

async function renderEventMap(location) {
  const directions = $('#map-directions');
  directions.hidden = true;
  const previous = map;
  map = null;
  const result = await mountLocationMap($('#event-map'), location, previous, () => Boolean(activeEvent) && activeEvent.extendedProps.location === location && !$('#event-modal').hidden);
  map = result.map;
  const osm = result.coords ? mapLinks(result.coords, location).osm : null;
  if (osm) {
    directions.href = osm;
    directions.hidden = false;
  }
}

async function geocodeLocation(location) {
  const key = String(location ?? '').trim().toLocaleLowerCase();
  if (!key) return null;
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  // Approximate locality coordinates for the three named North Devon sites.
  // Source references: https://thegreatbritainguide.com/place/brownsham/
  // https://thegreatbritainguide.com/place/peppercombe/
  // https://historicengland.org.uk/listing/heritage-gateway/results/record/c39bc47e-3b72-4a06-9863-681629e456a2/MDV30768
  // Other location labels are geocoded via Nominatim when opened.
  const knownSites = {
    'brownsham': { lat: 51.0076, lon: -4.4452 },
    'peppercombe': { lat: 50.9953, lon: -4.3075 },
    'east titchberry': { lat: 51.016116, lon: -4.504472 }
  };
  if (Object.prototype.hasOwnProperty.call(knownSites, key)) {
    const value = knownSites[key];
    GEO_CACHE.set(key, value);
    if (value) return value;
    // An event series label is not itself a mappable place; try searching it below.
  }
  const queries = [`${location}, North Devon, Devon, United Kingdom`, `${location}, Devon, United Kingdom`];
  for (const query of queries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const results = await response.json();
      if (Array.isArray(results) && results[0] && Number.isFinite(Number(results[0].lat)) && Number.isFinite(Number(results[0].lon))) {
        const result = { lat: Number(results[0].lat), lon: Number(results[0].lon) };
        GEO_CACHE.set(key, result);
        return result;
      }
    } catch (error) {
      console.warn('Geocoding request failed:', error);
    }
  }
  GEO_CACHE.set(key, null);
  return null;
}

function closeOnBackdrop(event) {
  if (event.target === $('#event-modal')) closeEventModal();
}

function trapModalFocus(event) {
  if ($('#event-modal').hidden || event.key !== 'Tab') return;
  const candidates = $$('button:not(:disabled), a[href]:not([hidden]), [tabindex]:not([tabindex="-1"])', $('#event-modal'))
    .filter((el) => !el.hidden && el.offsetParent !== null);
  if (!candidates.length) return;
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
}

function escapeICSText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

function icsDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
}

function nextICSDate(dateOnly) {
  const date = parseLocalDate(dateOnly);
  if (!date) return dateOnly;
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function foldICSLine(line) {
  // iCalendar lines are limited to 75 UTF-8 octets; continuation lines start with one space.
  const chunks = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = new TextEncoder().encode(character).length;
    if (octets + size > 75 && current) {
      chunks.push(current);
      current = ' ';
      octets = 1;
    }
    current += character;
    octets += size;
  }
  chunks.push(current);
  return chunks.join('\r\n');
}

function eventToICS(event) {
  const props = event.extendedProps;
  const stamp = icsDateTime(new Date().toISOString());
  const safeId = escapeICSText(event.id || `${Date.now()}`);
  const description = [
    props.description ? `Description: ${props.description}` : '',
    props.equipment ? `Required equipment: ${props.equipment}` : '',
    props.difficulty ? `Difficulty: ${props.difficulty}` : ''
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${safeId}@volunteer-plan-2027`,
    `DTSTAMP:${stamp}`
  ];
  if (event.allDay || isDateOnly(event.start)) {
    lines.push(`DTSTART;VALUE=DATE:${icsDateOnly(event.start)}`);
    const endValue = event.end ? icsDateOnly(event.end) : nextICSDate(event.start);
    lines.push(`DTEND;VALUE=DATE:${endValue}`);
  } else {
    lines.push(`DTSTART:${icsDateTime(event.start)}`);
    if (event.end) lines.push(`DTEND:${icsDateTime(event.end)}`);
  }
  lines.push(
    `SUMMARY:${escapeICSText(event.title)}`,
    `LOCATION:${escapeICSText(props.location || '')}`,
    `DESCRIPTION:${escapeICSText(description)}`,
    'END:VEVENT'
  );
  return lines.map(foldICSLine).join('\r\n');
}

function generateICS(events, filename = 'volunteer-plan-2027.ics') {
  if (!events.length) {
    showToast('There are no scheduled tasks to export yet.');
    return;
  }
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Volunteer Plan//2027 Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Volunteer Plan 2027',
    ...events.map(eventToICS),
    'END:VCALENDAR',
    ''
  ].join('\r\n');
  const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(events.length === 1 ? 'Calendar file prepared for 1 task.' : `Calendar file prepared for ${events.length} tasks.`);
}

function bindControls() {
  $('#task-search').addEventListener('input', () => renderDirectory());
  $('#location-filter').addEventListener('change', () => renderDirectory());
  $('#difficulty-filter').addEventListener('change', () => renderDirectory());
  $('#clear-filters').addEventListener('click', () => {
    $('#task-search').value = '';
    $('#location-filter').value = '';
    $('#difficulty-filter').value = '';
    renderDirectory();
    $('#task-search').focus();
  });
  $('#download-all-ics').addEventListener('click', () => generateICS(schedule));
  $('#next-ics').addEventListener('click', () => { if (nextEvent) generateICS([nextEvent], `${slugify(nextEvent.title)}-2027.ics`); });
  $('#next-share').addEventListener('click', shareNextDay);
  $('#next-copy-coords').addEventListener('click', async () => showToast(await copyText(nextCoordsText) ? 'Coordinates copied' : 'Could not copy the coordinates'));
  $('#download-event-ics').addEventListener('click', () => { if (activeEvent) generateICS([activeEvent], `${slugify(activeEvent.title)}-2027.ics`); });
  $('#close-modal').addEventListener('click', closeEventModal);
  $('#modal-close-secondary').addEventListener('click', closeEventModal);
  $('#event-modal').addEventListener('click', closeOnBackdrop);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEventModal();
    trapModalFocus(event);
  });
  window.addEventListener('resize', () => { if (calendar) calendar.updateSize(); });
}

function slugify(value) {
  return String(value ?? 'volunteer-task').toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'volunteer-task';
}

async function initialiseApp() {
  initialiseTheme();
  bindControls();
  refreshIcons();
  await loadSchedule();
  refreshIcons();
}

document.addEventListener('DOMContentLoaded', initialiseApp);

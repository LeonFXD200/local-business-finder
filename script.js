/**
 * Local Business Finder
 * Uses browser Geolocation + OpenStreetMap Overpass API
 * No API key required — pure static site
 */

'use strict';

// DOM refs
const findBtn         = document.getElementById('find-btn');
const radiusSelect    = document.getElementById('radius-select');
const statusArea      = document.getElementById('status-area');
const loadingEl       = document.getElementById('loading-indicator');
const loadingText     = document.getElementById('loading-text');
const errorBox        = document.getElementById('error-box');
const errorText       = document.getElementById('error-text');
const resultsSection  = document.getElementById('results-section');
const cardsGrid       = document.getElementById('cards-grid');
const resultsCount    = document.getElementById('results-count');
const emptyState      = document.getElementById('empty-state');
const locationDisplay = document.getElementById('location-display');
const coordsText      = document.getElementById('coords-text');
const tabs            = document.querySelectorAll('.tab');

// State
let allBusinesses = [];
let activeFilter  = 'all';

// Tags considered business-like
const BUSINESS_TAGS = ['shop', 'amenity', 'office', 'company', 'craft', 'tourism', 'leisure'];

// Friendly category labels
const CATEGORY_LABELS = {
  restaurant: 'Restaurant', cafe: 'Cafe', bar: 'Bar', pub: 'Pub',
  fast_food: 'Fast Food', bank: 'Bank', atm: 'ATM', pharmacy: 'Pharmacy',
  hospital: 'Hospital', clinic: 'Clinic', doctors: 'Doctor', dentist: 'Dentist',
  fuel: 'Petrol Station', parking: 'Parking', post_office: 'Post Office',
  car_wash: 'Car Wash', car_rental: 'Car Rental', gym: 'Gym',
  nightclub: 'Nightclub', cinema: 'Cinema', theatre: 'Theatre',
  library: 'Library', school: 'School', university: 'University',
  police: 'Police', fire_station: 'Fire Station', hotel: 'Hotel',
  supermarket: 'Supermarket', convenience: 'Convenience Store', bakery: 'Bakery',
  butcher: 'Butcher', greengrocer: 'Greengrocer', clothes: 'Clothing', shoes: 'Shoes',
  electronics: 'Electronics', mobile_phone: 'Mobile Phones', computer: 'Computer Store',
  furniture: 'Furniture', hardware: 'Hardware', bicycle: 'Bike Shop',
  car: 'Car Dealership', car_repair: 'Car Repair', beauty: 'Beauty', hairdresser: 'Hairdresser',
  optician: 'Optician', laundry: 'Laundry', dry_cleaning: 'Dry Cleaning',
  florist: 'Florist', gift: 'Gift Shop', jewelry: 'Jewellery', books: 'Book Shop',
  sports: 'Sports', toys: 'Toys', stationery: 'Stationery', pet: 'Pet Shop',
  travel_agency: 'Travel Agency', alcohol: 'Off-licence', wine: 'Wine Shop',
  accountant: 'Accountant', architect: 'Architect', consulting: 'Consultancy',
  estate_agent: 'Estate Agent', financial: 'Financial Services', insurance: 'Insurance',
  it: 'IT Services', lawyer: 'Solicitor', notary: 'Notary',
  motel: 'Motel', hostel: 'Hostel', guest_house: 'Guest House',
  attraction: 'Attraction', museum: 'Museum', gallery: 'Gallery',
  brewery: 'Brewery', carpenter: 'Carpenter', electrician: 'Electrician',
  gardener: 'Gardener', painter: 'Painter', photographer: 'Photographer',
  plumber: 'Plumber', printer: 'Printer', tailor: 'Tailor',
};

function friendlyCategory(tags) {
  for (const key of BUSINESS_TAGS) {
    if (tags[key]) {
      const val = tags[key];
      return CATEGORY_LABELS[val] || titleCase(val.replace(/_/g, ' '));
    }
  }
  return 'Business';
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// Geolocation
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => {
        const msgs = {
          1: 'Location access denied. Please allow location in your browser settings.',
          2: 'Location unavailable. Check your connection or device settings.',
          3: 'Location request timed out. Please try again.',
        };
        reject(new Error(msgs[err.code] || 'Unknown location error.'));
      },
      { timeout: 15000, maximumAge: 60000 }
    );
  });
}

// Overpass query
async function fetchBusinesses(lat, lon, radius) {
  const tagFilters = BUSINESS_TAGS.map(t => `node["${t}"]["name"](around:${radius},${lat},${lon});`).join('\n  ');
  const wayFilters = BUSINESS_TAGS.map(t => `way["${t}"]["name"](around:${radius},${lat},${lon});`).join('\n  ');

  const query = `[out:json][timeout:30];
(
  ${tagFilters}
  ${wayFilters}
);
out body;
>;
out skel qt;`;

  const url = 'https://overpass-api.de/api/interpreter';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });

  if (!resp.ok) throw new Error(`Overpass API error: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  return data.elements || [];
}

// Parse OSM elements into tidy business objects
function parseElements(elements) {
  const seen = new Set();
  const result = [];

  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name) continue;

    const key = tags.name + '|' + (el.lat ? el.lat.toFixed(3) : '') + '|' + (el.lon ? el.lon.toFixed(3) : '');
    if (seen.has(key)) continue;
    seen.add(key);

    const addrParts = [
      tags['addr:housenumber'] && tags['addr:street']
        ? `${tags['addr:housenumber']} ${tags['addr:street']}`
        : tags['addr:street'] || '',
      tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || '',
      tags['addr:postcode'] || '',
    ].filter(Boolean);

    const website = normaliseUrl(tags.website || tags['contact:website'] || tags.url || '');
    const phone   = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '';
    const hours   = tags.opening_hours || '';

    result.push({
      id:       el.id,
      name:     tags.name,
      category: friendlyCategory(tags),
      address:  addrParts.join(', '),
      website,
      phone:    phone.trim(),
      hours:    hours.trim(),
      hasWebsite: !!website,
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function normaliseUrl(url) {
  if (!url) return '';
  url = url.trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  return url;
}

// Rendering
function iconSvg(path, size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const ICONS = {
  location: iconSvg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  web:      iconSvg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
  phone:    iconSvg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.69a16 16 0 0 0 6.29 6.29l.86-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  clock:    iconSvg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
};

function renderCard(biz) {
  const addrHtml = biz.address
    ? `<div class="meta-row">${ICONS.location}<span>${escHtml(biz.address)}</span></div>`
    : '';
  const webHtml = biz.hasWebsite
    ? `<div class="meta-row">${ICONS.web}<a href="${escHtml(biz.website)}" target="_blank" rel="noopener noreferrer">${escHtml(displayUrl(biz.website))}</a></div>`
    : '';
  const phoneHtml = biz.phone
    ? `<div class="meta-row">${ICONS.phone}<span>${escHtml(biz.phone)}</span></div>`
    : '';
  const hoursHtml = biz.hours
    ? `<div class="meta-row">${ICONS.clock}<span class="hours">${escHtml(biz.hours)}</span></div>`
    : '';

  const prospectBadge = !biz.hasWebsite
    ? `<span class="badge badge-prospect">&#9733; No Website</span>`
    : '';

  return `
    <article class="biz-card ${biz.hasWebsite ? '' : 'no-website'}">
      <div class="card-header">
        <span class="card-name">${escHtml(biz.name)}</span>
      </div>
      <div class="card-badges">
        <span class="badge badge-type">${escHtml(biz.category)}</span>
        ${prospectBadge}
      </div>
      <div class="card-meta">
        ${addrHtml}
        ${webHtml}
        ${phoneHtml}
        ${hoursHtml}
      </div>
    </article>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

function applyFilter(filter) {
  activeFilter = filter;
  tabs.forEach(t => {
    const isActive = t.dataset.filter === filter;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  renderResults();
}

function renderResults() {
  let filtered = allBusinesses;
  if (activeFilter === 'has-website')  filtered = allBusinesses.filter(b => b.hasWebsite);
  if (activeFilter === 'no-website')   filtered = allBusinesses.filter(b => !b.hasWebsite);

  const total = filtered.length;
  resultsCount.textContent = `${total} result${total !== 1 ? 's' : ''}`;

  if (total === 0) {
    cardsGrid.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  cardsGrid.innerHTML = filtered.map(renderCard).join('');
}

// UI helpers
function showLoading(msg) {
  statusArea.style.display = 'block';
  loadingEl.style.display  = 'flex';
  errorBox.style.display   = 'none';
  loadingText.textContent  = msg;
}
function hideLoading() {
  loadingEl.style.display = 'none';
}
function showError(msg) {
  statusArea.style.display = 'block';
  loadingEl.style.display  = 'none';
  errorBox.style.display   = 'flex';
  errorText.textContent    = msg;
}
function hideStatus() {
  statusArea.style.display = 'none';
}

// Main flow
findBtn.addEventListener('click', async () => {
  findBtn.disabled = true;
  resultsSection.style.display = 'none';
  hideStatus();

  try {
    showLoading('Getting your location...');
    const { lat, lon } = await getLocation();

    coordsText.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    locationDisplay.style.display = 'flex';

    const radius = parseInt(radiusSelect.value, 10);
    const radiusKm = radius / 1000;
    showLoading(`Searching within ${radiusKm} km via OpenStreetMap...`);

    const elements = await fetchBusinesses(lat, lon, radius);
    allBusinesses = parseElements(elements);

    hideLoading();
    hideStatus();

    if (allBusinesses.length === 0) {
      showError(`No named businesses found within ${radiusKm} km. Try a larger radius.`);
      findBtn.disabled = false;
      return;
    }

    resultsSection.style.display = 'block';
    applyFilter(activeFilter === 'all' ? 'all' : activeFilter);

  } catch (err) {
    showError(err.message || 'An unexpected error occurred.');
  } finally {
    findBtn.disabled = false;
  }
});

// Tab clicks
tabs.forEach(tab => {
  tab.addEventListener('click', () => applyFilter(tab.dataset.filter));
});

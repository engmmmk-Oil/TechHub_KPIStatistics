# Tech Hub — Operations Dashboard

Internal Tech Hub KPI dashboard for Alkhorayef Petroleum Company. Static HTML + JavaScript application that runs entirely in the browser.

## Quick Start

1. Push these files to a GitHub repository
2. Enable GitHub Pages: Settings → Pages → Deploy from branch → main → root
3. Visit the URL GitHub provides (e.g. `https://yourname.github.io/techhub`)
4. Sign in using the viewer password (see below)

## Access

| Role | Password | What they can do |
|---|---|---|
| **Viewer** | `TechHub26-view` | View all dashboards, search records, see all KPIs and charts |
| **Admin** | `TechHub26` | Everything above, plus: add/edit/delete tickets, manage dropdowns, import/export data, reset |

> ⚠️ Browser passwords are not enterprise security. Treat the URL as the real access control — don't share it widely.

## Files in this repo

| File | Purpose |
|---|---|
| `index.html` | Main page — uses CDN scripts (production) |
| `index-qa.html` | Local QA version with vendor/ scripts — not needed in production |
| `styles.css` | All styling |
| `app.js` | Application logic (~1500 lines) |
| `data.csv` | Seed data — loaded the first time anyone opens the app |
| `dropdowns.json` | Initial dropdown reference (used by build, not at runtime) |
| `vendor/` | Local fallback scripts for QA testing only — safe to delete in production |
| `screenshot-pw.js` | Internal QA tool — safe to delete in production |

## How data works

- First page load: app fetches `data.csv` and loads 308 records into the browser's localStorage
- After that: all reads and writes are against localStorage in the visitor's browser
- Adding/editing tickets: changes save to localStorage only — they do NOT update `data.csv` in the repo
- To update the seed data for new visitors: replace `data.csv` and commit/push

## Daily workflow (Admin)

1. Open the dashboard, log in with the admin password
2. Add new tickets via **+ New ticket** in the sidebar
3. Edit existing tickets from **All Records** → pencil icon
4. Periodically: **Settings → Data → Export CSV** to backup
5. To share latest data with new users: copy the exported CSV to `data.csv` in the repo and push

## Daily workflow (Viewer)

1. Open the dashboard, log in with the viewer password
2. Browse Dashboard / YoY / SLA / MTTR / Volume / Workload / Matrix / Records
3. Use filter bar (year / region / priority) to focus the data
4. Export CSV or Excel from All Records if a snapshot is needed

## Adding a new dropdown value

1. Settings (admin password)
2. Dropdowns tab
3. Click the relevant list (Region, Customer, Owner, etc.)
4. Type in the search box at top right → Add

## Pages

| Page | Content |
|---|---|
| Dashboard | 12 KPIs (lifetime + filtered), SLA by priority chart, SLA by region chart, monthly trend, top 5 customers, top 5 owners |
| Year-over-Year | Current vs prior year cards, full history table, 5 multi-year comparison charts |
| SLA Analysis | By priority, by region, top 10 owners |
| MTTR Analysis | By priority (with SLA target), by region, by category |
| Volume Trends | Monthly volume, category mix donut, priority mix donut, region distribution bar |
| Workload & Aging | Aging buckets, top 15 owners by workload |
| Priority Matrix | Governance reference + live performance against the matrix |
| All Records | Searchable, sortable, filterable table with view/edit/delete actions; CSV/Excel export |
| Settings | (Admin only) Manage dropdowns, import/export data, reset |

## Browser compatibility

Tested in Chrome, Edge, Safari. Should work in any modern browser (Firefox, Opera). Requires JavaScript enabled.

## Data privacy

- Customer names, employee names, and request descriptions live in `data.csv` and visitor browsers
- If hosted on a public GitHub Pages site, anyone with the URL can view all data
- For private hosting, use a private GitHub repo with a paid plan that supports Pages

## Browser storage limit

localStorage is roughly 5–10 MB per domain. Current data (308 records) uses about 250 KB. The app can comfortably handle 5,000+ records before hitting any browser limit.

## Updating

To deploy code changes: push to the main branch. GitHub Pages rebuilds automatically (1–2 minutes).

To force-refresh data for an existing user: replace `data.csv`, then ask them to clear localStorage (DevTools → Application → Local Storage → Clear) and reload.

---

Built for Alkhorayef Petroleum Company — GOS Department.

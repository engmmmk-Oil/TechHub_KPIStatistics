/* ===========================================================================
   Tech Hub — Operations Dashboard
   - Single-page app, hash routing
   - Two-tier password gate (viewer + admin)
   - localStorage data persistence + CSV import/export
   - Dropdowns editable via Settings
   - All KPIs, charts, filters
=========================================================================== */

const PWD_VIEWER = 'TechHub26-view';
const PWD_ADMIN  = 'TechHub26';
const STORAGE_KEY     = 'techhub_data_v1';
const STORAGE_DROPS   = 'techhub_dropdowns_v1';
const STORAGE_META    = 'techhub_meta_v1';
const REF_DATE_FALLBACK = new Date(2026, 4, 17); // 17-May-2026

// SLA targets in hours (lifetime reference; can be overridden in Settings)
const DEFAULT_SLA = {
  'Critical (6 Hours)':      6,
  'High (1 Working day)':    24,
  'Medium (3 Working days)': 72,
  'Low (5 Working days)':    120
};

// Country → Region defaults
const COUNTRY_TO_REGION = {
  'Kuwait': 'Kuwait',
  'Saudi Arabia': 'Middle East',
  'Iraq': 'Middle East',
  'Indonesia': 'Middle East',
  'Colombia': 'Latin America',
  'Ecuador': 'Latin America',
  'Mexico': 'Latin America',
  'Egypt': 'Africa',
  'Congo': 'Africa',
  'Sudan': 'Africa'
};

// Default dropdowns
const DEFAULT_DROPDOWNS = {
  Region:        ['Kuwait','Middle East','Latin America','Africa'],
  Country:       Object.keys(COUNTRY_TO_REGION),
  Priority:      Object.keys(DEFAULT_SLA),
  Category:      ['Application Engineering','Field Service / Rig related','Manufacturing, Assembly, Repair and Test'],
  SubCategory:   [],
  StatusReason:  ['Resolved','Resolved (Automatically)'],
  ResponseDone:  ['Yes','No','Answered before','Need more information'],
  SLAStatus:     ['Succeeded','Noncompliant','Canceled','In Progress'],
  Customer:      [],
  CreatedBy:     [],
  ResolvedBy:    [],
  RequestType:   [],
  ImpactFlag:    ['Yes','No','N/A']
};

// ====== STATE ======
let STATE = {
  records: [],
  dropdowns: {},
  filters: { year: 'all', region: 'all', priority: 'all' },
  isAdmin: false,
  currentPage: 'dashboard',
  charts: {}
};

// ====== UTILITIES ======
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function toast(msg, kind='') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind ? `toast-${kind}` : '');
  setTimeout(() => t.classList.add('hidden'), 2200);
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function fmtDate(d, opts = {short: false}) {
  d = parseDate(d);
  if (!d) return '—';
  if (opts.short) return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'2-digit'});
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function fmtNum(n, decimals=0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
}

function fmtPct(n, decimals=1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n * 100).toFixed(decimals) + '%';
}

function fmtSigned(n, decimals=1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(decimals);
}

function diffHours(d1, d2) {
  const a = parseDate(d1), b = parseDate(d2);
  if (!a || !b) return null;
  return (b - a) / (1000 * 60 * 60);
}

// ====== STORAGE ======
function loadStorage() {
  try {
    const recs = localStorage.getItem(STORAGE_KEY);
    if (recs) STATE.records = JSON.parse(recs);
  } catch(e) { console.error('Failed to load records:', e); STATE.records = []; }

  try {
    const drops = localStorage.getItem(STORAGE_DROPS);
    if (drops) STATE.dropdowns = JSON.parse(drops);
    else STATE.dropdowns = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
  } catch(e) { STATE.dropdowns = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS)); }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.records));
    localStorage.setItem(STORAGE_META, JSON.stringify({lastRefreshed: new Date().toISOString()}));
  } catch (e) {
    toast('Save failed — localStorage limit reached. Export CSV.', 'error');
    console.error(e);
  }
}

function saveDropdowns() {
  localStorage.setItem(STORAGE_DROPS, JSON.stringify(STATE.dropdowns));
}

// ====== RECORD COMPUTED FIELDS ======
function enrich(r) {
  // Returns an enriched view; doesn't mutate
  const e = {...r};
  const created = parseDate(r.created_on);
  const response = parseDate(r.response_date);
  const acceptance = parseDate(r.acceptance_date);

  e._created = created;
  e._response = response;
  e._acceptance = acceptance;
  e._year = created ? created.getFullYear() : null;
  e._yearMonth = created ? `${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,'0')}` : null;

  e._slaTargetHrs = DEFAULT_SLA[r.priority] || null;
  e._responseTAT = diffHours(created, response);
  e._mttr = diffHours(created, acceptance);
  e._respVsTarget = (e._responseTAT != null && e._slaTargetHrs != null) ? e._responseTAT - e._slaTargetHrs : null;

  // SLA status normalization
  if (r.sla_status === 'Succeeded') e._slaCompliant = 'Compliant';
  else if (r.sla_status === 'Noncompliant') e._slaCompliant = 'Breached';
  else e._slaCompliant = 'Excluded';

  // Validity flags (excludes CRM migration artifacts >720hr)
  e._tatValid  = (e._responseTAT != null && e._responseTAT >= 0 && e._responseTAT <= 720);
  e._mttrValid = (e._mttr != null && e._mttr >= 0 && e._mttr <= 720);

  // Aging
  const refDate = new Date();
  e._ageDays = created ? Math.floor((refDate - created) / (1000*60*60*24)) : null;
  if (e._ageDays == null) e._ageBucket = 'Unknown';
  else if (e._ageDays <= 7) e._ageBucket = '0-7 days';
  else if (e._ageDays <= 14) e._ageBucket = '8-14 days';
  else if (e._ageDays <= 30) e._ageBucket = '15-30 days';
  else if (e._ageDays <= 90) e._ageBucket = '31-90 days';
  else e._ageBucket = '>90 days';

  // Open status
  e._isOpen = !acceptance && r.status_reason !== 'Resolved' && r.status_reason !== 'Resolved (Automatically)';

  // Test record exclusion
  const t = (r.request_title || '').trim().toLowerCase();
  e._isTest = (t === 'test' || t === 'm' || r.category === 'Test Category' || r.sub_category === 'Test');
  e._includeKPI = !e._isTest;

  return e;
}

function enrichedAll() { return STATE.records.map(enrich); }

// ====== FILTERS ======
function applyFilters(records) {
  return records.filter(r => {
    if (!r._includeKPI) return false;
    const f = STATE.filters;
    if (f.year !== 'all' && String(r._year) !== String(f.year)) return false;
    if (f.region !== 'all' && r.region !== f.region) return false;
    if (f.priority !== 'all' && r.priority !== f.priority) return false;
    return true;
  });
}

// ====== KPI COMPUTATIONS ======
function computeKPIs(records) {
  const total = records.length;
  const compl = records.filter(r => r._slaCompliant === 'Compliant').length;
  const breach = records.filter(r => r._slaCompliant === 'Breached').length;
  const slaCompliance = (compl + breach) > 0 ? compl / (compl + breach) : null;

  const validTat = records.filter(r => r._tatValid);
  const avgTat = validTat.length ? validTat.reduce((a, r) => a + r._responseTAT, 0) / validTat.length : null;

  const validMttr = records.filter(r => r._mttrValid);
  const avgMttr = validMttr.length ? validMttr.reduce((a, r) => a + r._mttr, 0) / validMttr.length : null;

  const validVt = records.filter(r => r._tatValid && r._respVsTarget != null);
  const avgVsTarget = validVt.length ? validVt.reduce((a, r) => a + r._respVsTarget, 0) / validVt.length : null;

  const npt = records.filter(r => r.npt_reduction === 'Yes').length;
  const prod = records.filter(r => r.production_recovery === 'Yes').length;
  const cost = records.filter(r => r.cost_optimized === 'Yes').length;
  const capture = total ? (npt + prod + cost) / total : 0;

  const open = records.filter(r => r._isOpen).length;
  const backlogOld = records.filter(r => r._isOpen && r._ageDays > 30).length;

  // Critical SLA Compliance
  const critical = records.filter(r => r.priority === 'Critical (6 Hours)');
  const critC = critical.filter(r => r._slaCompliant === 'Compliant').length;
  const critB = critical.filter(r => r._slaCompliant === 'Breached').length;
  const criticalComp = (critC + critB) > 0 ? critC / (critC + critB) : null;

  // First Response < 1hr %
  const within1hr = validTat.filter(r => r._responseTAT <= 1).length;
  const fastResp = validTat.length ? within1hr / validTat.length : null;

  return {
    total, compl, breach, slaCompliance, avgTat, avgMttr, avgVsTarget,
    npt, prod, cost, capture, open, backlogOld, criticalComp, fastResp
  };
}

// ====== ROUTING ======
const ROUTES = {
  'dashboard': renderDashboard,
  'yoy':       renderYoY,
  'sla':       renderSLA,
  'mttr':      renderMTTR,
  'volume':    renderVolume,
  'workload':  renderWorkload,
  'matrix':    renderMatrix,
  'records':   renderRecords,
  'new':       renderNewTicket,
  'settings':  renderSettings,
};

function navigate() {
  const hash = (location.hash || '#/dashboard').replace(/^#\//, '');
  const page = ROUTES[hash] ? hash : 'dashboard';
  STATE.currentPage = page;
  // Admin gate for settings
  if (page === 'settings' && !STATE.isAdmin) {
    openAdminGate(() => { renderPage(page); });
    return;
  }
  renderPage(page);
}

function renderPage(page) {
  // Destroy existing charts
  Object.values(STATE.charts).forEach(c => { try { c.destroy(); } catch(e){} });
  STATE.charts = {};

  // Close any open record modal (don't carry across routes)
  const openModal = document.getElementById('rec-modal');
  if (openModal && page !== 'new') openModal.remove();

  // Active nav
  $$('.sb-link').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  // Topbar visibility
  const showFilters = ['dashboard','sla','mttr','volume','workload'].includes(page);
  $('#topbar-filters').style.display = showFilters ? 'flex' : 'none';

  const titles = {
    dashboard: 'Executive Dashboard',
    yoy: 'Year-over-Year Comparison',
    sla: 'SLA Analysis',
    mttr: 'MTTR Analysis',
    volume: 'Volume Trends',
    workload: 'Workload & Aging',
    matrix: 'Priority Matrix',
    records: 'All Records',
    new: 'New Ticket',
    settings: 'Settings'
  };
  $('#topbar-title').textContent = titles[page] || 'Tech Hub';

  ROUTES[page]();
  refreshSidebarMeta();
}

function refreshSidebarMeta() {
  $('#sb-record-count').textContent = STATE.records.length.toLocaleString();
  const meta = localStorage.getItem(STORAGE_META);
  if (meta) {
    try {
      const m = JSON.parse(meta);
      $('#sb-refreshed').textContent = fmtDate(m.lastRefreshed, {short: true});
    } catch(e) { $('#sb-refreshed').textContent = '—'; }
  } else {
    $('#sb-refreshed').textContent = fmtDate(new Date(), {short: true});
  }
}

// ====== FILTER BAR ======
function buildFilterBar() {
  const all = enrichedAll().filter(r => r._includeKPI);
  const years = [...new Set(all.map(r => r._year).filter(y => y))].sort();
  const regions = [...new Set(all.map(r => r.region).filter(Boolean))].sort();
  const priorities = [...new Set(all.map(r => r.priority).filter(Boolean))].sort();

  const fillSel = (sel, items, cur) => {
    sel.innerHTML = `<option value="all">All</option>` + items.map(i => `<option value="${escapeHtml(i)}" ${cur===String(i)?'selected':''}>${escapeHtml(i)}</option>`).join('');
  };

  fillSel($('#filter-year'), years, STATE.filters.year);
  fillSel($('#filter-region'), regions, STATE.filters.region);
  fillSel($('#filter-priority'), priorities, STATE.filters.priority);

  // Set current filters
  $('#filter-year').value = STATE.filters.year;
  $('#filter-region').value = STATE.filters.region;
  $('#filter-priority').value = STATE.filters.priority;
}

function setupFilterListeners() {
  $('#filter-year').addEventListener('change', e => { STATE.filters.year = e.target.value; renderPage(STATE.currentPage); });
  $('#filter-region').addEventListener('change', e => { STATE.filters.region = e.target.value; renderPage(STATE.currentPage); });
  $('#filter-priority').addEventListener('change', e => { STATE.filters.priority = e.target.value; renderPage(STATE.currentPage); });
  $('#filter-reset').addEventListener('click', () => {
    STATE.filters = { year: 'all', region: 'all', priority: 'all' };
    buildFilterBar();
    renderPage(STATE.currentPage);
  });
}

// ====== HTML ESCAPE ======
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ====== KPI CARD HTML ======
function kpiCardHTML(label, value, unit, tone='', delta='') {
  const toneCls = tone ? `kpi-${tone}` : '';
  const deltaHTML = delta ? `<div class="kpi-delta">${delta}</div>` : '';
  return `<div class="kpi ${toneCls}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}${unit ? `<span class="kpi-unit">${unit}</span>` : ''}</div>
    ${deltaHTML}
  </div>`;
}

// ====== DASHBOARD PAGE ======
function renderDashboard() {
  buildFilterBar();
  const all = enrichedAll();
  const lifetime = all.filter(r => r._includeKPI);
  const filtered = applyFilters(all);

  const k = computeKPIs(filtered);

  const html = `
    <div class="section">
      <div class="section-head">
        <div class="section-title">${STATE.filters.year === 'all' ? 'Overall performance' : `Year ${STATE.filters.year}`}</div>
        <div class="section-note">${filtered.length} records · ${STATE.filters.region === 'all' ? 'All regions' : STATE.filters.region} · ${STATE.filters.priority === 'all' ? 'All priorities' : STATE.filters.priority}</div>
      </div>

      <div class="kpi-grid">
        ${kpiCardHTML('Total requests', fmtNum(k.total), '', '')}
        ${kpiCardHTML('SLA compliance', k.slaCompliance == null ? '—' : fmtPct(k.slaCompliance), '', complianceTone(k.slaCompliance))}
        ${kpiCardHTML('Avg response TAT', k.avgTat == null ? '—' : k.avgTat.toFixed(1), 'hrs', '')}
        ${kpiCardHTML('SLA breaches', fmtNum(k.breach), '', k.breach > 0 ? 'bad' : 'good')}
        ${kpiCardHTML('Response vs target', k.avgVsTarget == null ? '—' : fmtSigned(k.avgVsTarget,1), 'hrs', k.avgVsTarget <= 0 ? 'good' : 'bad')}
        ${kpiCardHTML('Critical SLA compliance', k.criticalComp == null ? '—' : fmtPct(k.criticalComp), '', complianceTone(k.criticalComp))}
      </div>

      <div class="mt-16">
        <div class="kpi-grid">
          ${kpiCardHTML('First response <1hr', k.fastResp == null ? '—' : fmtPct(k.fastResp), '', 'accent')}
          ${kpiCardHTML('Open requests', fmtNum(k.open), '', k.open > 0 ? 'warn' : 'good')}
          ${kpiCardHTML('Backlog >30 days', fmtNum(k.backlogOld), '', k.backlogOld > 0 ? 'bad' : 'good')}
          ${kpiCardHTML('NPT reductions', fmtNum(k.npt), '', 'accent')}
          ${kpiCardHTML('Production recovery', fmtNum(k.prod), '', 'accent')}
          ${kpiCardHTML('Impact capture rate', fmtPct(k.capture), '', 'accent')}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Performance by priority &amp; region</div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">SLA compliance by priority</div>
          </div>
          <div class="chart-box"><canvas id="ch-priority"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">SLA compliance by region</div>
          </div>
          <div class="chart-box"><canvas id="ch-region"></canvas></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Volume trend</div>
      </div>
      <div class="panel">
        <div class="chart-box lg"><canvas id="ch-trend"></canvas></div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Top customers &amp; owners</div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">Top 5 customers by volume</div>
          </div>
          <div class="chart-box"><canvas id="ch-customers"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">Top 5 owners by volume</div>
          </div>
          <div class="chart-box"><canvas id="ch-owners"></canvas></div>
        </div>
      </div>
    </div>
  `;
  $('#page').innerHTML = html;

  // ---- Build charts ----
  buildPriorityChart(filtered);
  buildRegionChart(filtered);
  buildTrendChart(filtered);
  buildTopCustomersChart(filtered);
  buildTopOwnersChart(filtered);

  setupFilterListeners();
}

function complianceTone(v) {
  if (v == null) return '';
  if (v >= 0.85) return 'good';
  if (v >= 0.65) return 'warn';
  return 'bad';
}

// ====== CHARTS ======
const C = {
  ink:   '#0F1B2D',
  steel: '#3D6B91',
  burnt: '#D97757',
  sage:  '#5A8F6B',
  brick: '#B04545',
  amber: '#C49434',
  line:  '#E5E2DA',
  text3: '#6B7280'
};

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { font: { family: 'Inter', size: 11 }, color: C.text3, boxWidth: 10, boxHeight: 10, padding: 12 }
      },
      tooltip: {
        backgroundColor: C.ink,
        titleFont: { family: 'Inter', size: 12, weight: '600' },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        padding: 10,
        cornerRadius: 6,
        boxPadding: 4
      }
    },
    scales: {
      x: {
        grid: { color: C.line, drawBorder: false },
        ticks: { font: { family: 'Inter', size: 11 }, color: C.text3 }
      },
      y: {
        grid: { color: C.line, drawBorder: false },
        ticks: { font: { family: 'JetBrains Mono', size: 11 }, color: C.text3 }
      }
    }
  };
}

function buildPriorityChart(records) {
  const priorities = ['Critical (6 Hours)', 'High (1 Working day)', 'Medium (3 Working days)', 'Low (5 Working days)'];
  const data = priorities.map(p => {
    const sub = records.filter(r => r.priority === p);
    const c = sub.filter(r => r._slaCompliant === 'Compliant').length;
    const b = sub.filter(r => r._slaCompliant === 'Breached').length;
    return {p, c, b};
  });

  const ctx = $('#ch-priority').getContext('2d');
  STATE.charts.priority = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: priorities.map(p => p.split(' ')[0]),
      datasets: [
        { label: 'Compliant', data: data.map(d => d.c), backgroundColor: C.sage, borderRadius: 4 },
        { label: 'Breached',  data: data.map(d => d.b), backgroundColor: C.brick, borderRadius: 4 }
      ]
    },
    options: { ...chartDefaults(), scales: { ...chartDefaults().scales, x: { ...chartDefaults().scales.x, stacked: true }, y: { ...chartDefaults().scales.y, stacked: true } } }
  });
}

function buildRegionChart(records) {
  const regions = STATE.dropdowns.Region || ['Kuwait','Middle East','Latin America','Africa'];
  const data = regions.map(rg => {
    const sub = records.filter(r => r.region === rg);
    const c = sub.filter(r => r._slaCompliant === 'Compliant').length;
    const b = sub.filter(r => r._slaCompliant === 'Breached').length;
    return {rg, c, b};
  });

  const ctx = $('#ch-region').getContext('2d');
  STATE.charts.region = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: regions,
      datasets: [
        { label: 'Compliant', data: data.map(d => d.c), backgroundColor: C.sage, borderRadius: 4 },
        { label: 'Breached',  data: data.map(d => d.b), backgroundColor: C.brick, borderRadius: 4 }
      ]
    },
    options: chartDefaults()
  });
}

function buildTrendChart(records) {
  // Aggregate by year-month
  const months = {};
  records.forEach(r => {
    if (!r._yearMonth) return;
    if (!months[r._yearMonth]) months[r._yearMonth] = { total: 0, compliant: 0, breached: 0 };
    months[r._yearMonth].total++;
    if (r._slaCompliant === 'Compliant') months[r._yearMonth].compliant++;
    if (r._slaCompliant === 'Breached')  months[r._yearMonth].breached++;
  });
  const labels = Object.keys(months).sort();
  const totals = labels.map(l => months[l].total);
  const compRate = labels.map(l => {
    const m = months[l];
    return (m.compliant + m.breached) > 0 ? (m.compliant / (m.compliant + m.breached)) * 100 : null;
  });

  const ctx = $('#ch-trend').getContext('2d');
  const opt = chartDefaults();
  STATE.charts.trend = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Requests', data: totals, backgroundColor: C.steel, borderRadius: 3, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Compliance %', data: compRate, borderColor: C.burnt, backgroundColor: C.burnt, tension: 0.35, yAxisID: 'y1', pointRadius: 3, borderWidth: 2, order: 1, spanGaps: true }
      ]
    },
    options: {
      ...opt,
      scales: {
        x: { ...opt.scales.x, ticks: { ...opt.scales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y:  { ...opt.scales.y, beginAtZero: true, title: { display: true, text: 'Requests', font: { family:'Inter', size: 11 }, color: C.text3 } },
        y1: { position: 'right', beginAtZero: true, max: 100, grid: { drawOnChartArea: false }, ticks: { font:{family:'JetBrains Mono',size:11}, color: C.text3, callback: v => v + '%' }, title: { display: true, text: 'Compliance %', font: { family:'Inter', size: 11 }, color: C.text3 } }
      }
    }
  });
}

function buildTopCustomersChart(records) {
  const counts = {};
  records.forEach(r => {
    const c = r.customer || '—';
    counts[c] = (counts[c]||0) + 1;
  });
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,5);
  const ctx = $('#ch-customers').getContext('2d');
  STATE.charts.customers = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(t => t[0].length > 28 ? t[0].slice(0,28)+'…' : t[0]),
      datasets: [{ data: top.map(t => t[1]), backgroundColor: C.steel, borderRadius: 4 }]
    },
    options: { ...chartDefaults(), indexAxis: 'y', plugins: { ...chartDefaults().plugins, legend: { display: false } } }
  });
}

function buildTopOwnersChart(records) {
  const counts = {};
  records.forEach(r => {
    const o = r.resolved_by || '—';
    counts[o] = (counts[o]||0) + 1;
  });
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,5);
  const ctx = $('#ch-owners').getContext('2d');
  STATE.charts.owners = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(t => t[0].length > 28 ? t[0].slice(0,28)+'…' : t[0]),
      datasets: [{ data: top.map(t => t[1]), backgroundColor: C.burnt, borderRadius: 4 }]
    },
    options: { ...chartDefaults(), indexAxis: 'y', plugins: { ...chartDefaults().plugins, legend: { display: false } } }
  });
}

// ====== YEAR-OVER-YEAR PAGE ======
function renderYoY() {
  const all = enrichedAll().filter(r => r._includeKPI);
  const years = [...new Set(all.map(r => r._year).filter(y => y))].sort();
  const currentYear = Math.max(...years);
  const priorYear = currentYear - 1;

  const html = `
    <div class="section">
      <div class="section-head">
        <div class="section-title">Compare two years</div>
      </div>

      <div class="panel">
        <div class="flex gap-16" style="align-items: flex-end; flex-wrap: wrap;">
          <div class="field">
            <label>Current year</label>
            <select id="yoy-cur" style="padding:6px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--canvas);font-size:14px;min-width:120px;">
              ${years.map(y => `<option value="${y}" ${y===currentYear?'selected':''}>${y}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Compare to</label>
            <select id="yoy-prior" style="padding:6px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--canvas);font-size:14px;min-width:120px;">
              ${years.map(y => `<option value="${y}" ${y===priorYear?'selected':''}>${y}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    </div>

    <div id="yoy-content"></div>
  `;
  $('#page').innerHTML = html;

  const renderYoYContent = () => {
    const cur = parseInt($('#yoy-cur').value);
    const pr  = parseInt($('#yoy-prior').value);
    const curR = all.filter(r => r._year === cur);
    const prR  = all.filter(r => r._year === pr);
    const cK = computeKPIs(curR);
    const pK = computeKPIs(prR);

    const dCompliance = (cK.slaCompliance != null && pK.slaCompliance != null) ? cK.slaCompliance - pK.slaCompliance : null;
    const dVol = cK.total - pK.total;
    const dVolPct = pK.total > 0 ? (cK.total - pK.total) / pK.total : null;
    const dTat = (cK.avgTat != null && pK.avgTat != null) ? cK.avgTat - pK.avgTat : null;
    const dBreach = cK.breach - pK.breach;
    const dVsTarget = (cK.avgVsTarget != null && pK.avgVsTarget != null) ? cK.avgVsTarget - pK.avgVsTarget : null;

    const trendLabel = (v, betterLow=true) => {
      if (v == null) return '—';
      if (Math.abs(v) < 0.001) return '● Flat';
      const isBetter = betterLow ? v < 0 : v > 0;
      return isBetter ? `▼ ${betterLow?'Faster':'Better'}` : `▲ ${betterLow?'Slower':'Worse'}`;
    };

    const html2 = `
      <div class="section">
        <div class="section-head">
          <div class="section-title">Service level compliance</div>
        </div>
        <div class="grid-2">
          <div class="panel">
            <div class="kpi-grid">
              ${kpiCardHTML(`${cur} compliance`, cK.slaCompliance == null ? '—' : fmtPct(cK.slaCompliance), '', complianceTone(cK.slaCompliance))}
              ${kpiCardHTML(`${pr} compliance`, pK.slaCompliance == null ? '—' : fmtPct(pK.slaCompliance), '', complianceTone(pK.slaCompliance))}
              ${kpiCardHTML('Δ change', dCompliance == null ? '—' : (dCompliance > 0 ? '+' : '') + (dCompliance * 100).toFixed(1) + ' pp', '', dCompliance > 0 ? 'good' : (dCompliance < 0 ? 'bad' : ''))}
            </div>
          </div>
          <div class="panel">
            <div class="kpi-grid">
              ${kpiCardHTML(`${cur} volume`, fmtNum(cK.total), '', '')}
              ${kpiCardHTML(`${pr} volume`, fmtNum(pK.total), '', '')}
              ${kpiCardHTML('Δ change', `${dVol >=0 ? '+' : ''}${dVol} (${dVolPct == null ? '—' : ((dVolPct>0?'+':'')+(dVolPct*100).toFixed(1)+'%')})`, '', '')}
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">Response time &amp; breaches</div>
        </div>
        <div class="grid-2">
          <div class="panel">
            <div class="kpi-grid">
              ${kpiCardHTML(`${cur} avg response`, cK.avgTat == null ? '—' : cK.avgTat.toFixed(1), 'hrs')}
              ${kpiCardHTML(`${pr} avg response`, pK.avgTat == null ? '—' : pK.avgTat.toFixed(1), 'hrs')}
              ${kpiCardHTML('Δ change', dTat == null ? '—' : fmtSigned(dTat,1) + ' hrs', '', dTat < 0 ? 'good' : (dTat > 0 ? 'bad' : ''))}
            </div>
            <div class="text-mute text-small mt-8">${trendLabel(dTat)}</div>
          </div>
          <div class="panel">
            <div class="kpi-grid">
              ${kpiCardHTML(`${cur} breaches`, fmtNum(cK.breach), '', cK.breach > 0 ? 'bad' : 'good')}
              ${kpiCardHTML(`${pr} breaches`, fmtNum(pK.breach), '', pK.breach > 0 ? 'bad' : 'good')}
              ${kpiCardHTML('Δ change', `${dBreach >= 0 ? '+' : ''}${dBreach}`, '', dBreach < 0 ? 'good' : (dBreach > 0 ? 'bad' : ''))}
            </div>
            <div class="text-mute text-small mt-8">${trendLabel(dBreach)}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">Response vs target</div>
        </div>
        <div class="panel">
          <div class="kpi-grid">
            ${kpiCardHTML(`${cur} avg vs target`, cK.avgVsTarget == null ? '—' : fmtSigned(cK.avgVsTarget,1), 'hrs', cK.avgVsTarget <= 0 ? 'good' : 'bad')}
            ${kpiCardHTML(`${pr} avg vs target`, pK.avgVsTarget == null ? '—' : fmtSigned(pK.avgVsTarget,1), 'hrs', pK.avgVsTarget <= 0 ? 'good' : 'bad')}
            ${kpiCardHTML('Δ change', dVsTarget == null ? '—' : fmtSigned(dVsTarget,1) + ' hrs', '', dVsTarget < 0 ? 'good' : (dVsTarget > 0 ? 'bad' : ''))}
          </div>
          <div class="text-mute text-small mt-8">Negative = within SLA · Positive = exceeded target</div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">Full historical trend</div>
          <div class="section-note">All years on record · current year highlighted yellow · prior year blue</div>
        </div>
        <div class="panel">
          <div class="table-wrap">${historicalTable(all, cur, pr)}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">Yearly comparison — all KPIs</div>
          <div class="section-note">Each chart shows every year in the dataset · current &amp; prior years highlighted</div>
        </div>
        <div class="grid-2">
          <div class="panel">
            <div class="panel-head"><div class="panel-title">Total requests by year</div></div>
            <div class="chart-box"><canvas id="ch-yoy-volume"></canvas></div>
          </div>
          <div class="panel">
            <div class="panel-head"><div class="panel-title">SLA compliance % by year</div></div>
            <div class="chart-box"><canvas id="ch-yoy-compliance"></canvas></div>
          </div>
          <div class="panel">
            <div class="panel-head"><div class="panel-title">Avg response TAT (hrs) by year</div></div>
            <div class="chart-box"><canvas id="ch-yoy-tat"></canvas></div>
          </div>
          <div class="panel">
            <div class="panel-head"><div class="panel-title">SLA breaches by year</div></div>
            <div class="chart-box"><canvas id="ch-yoy-breaches"></canvas></div>
          </div>
          <div class="panel" style="grid-column: span 2;">
            <div class="panel-head">
              <div class="panel-title">Response vs target (hrs) by year</div>
              <div class="panel-note">Negative bars = within SLA · positive bars = exceeded target</div>
            </div>
            <div class="chart-box"><canvas id="ch-yoy-vstarget"></canvas></div>
          </div>
        </div>
      </div>
    `;
    $('#yoy-content').innerHTML = html2;
    buildYoYMultiCharts(all, cur, pr);
  };

  $('#yoy-cur').addEventListener('change', renderYoYContent);
  $('#yoy-prior').addEventListener('change', renderYoYContent);
  renderYoYContent();
}

function historicalTable(all, curYr, prYr) {
  const years = [...new Set(all.map(r => r._year).filter(y => y))].sort();
  const rows = years.map(y => {
    const sub = all.filter(r => r._year === y);
    const k = computeKPIs(sub);
    return { y, k };
  });
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th>Year</th>
          <th class="num">Volume</th>
          <th class="num">Compliance %</th>
          <th class="num">Avg TAT (hrs)</th>
          <th class="num">Breaches</th>
          <th class="num">vs Target (hrs)</th>
          <th class="num">Open</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const hl = r.y === curYr ? 'style="background: #FCEFCC;"' : (r.y === prYr ? 'style="background: #E8EFF4;"' : '');
          return `<tr ${hl}>
            <td class="mono"><strong>${r.y}</strong></td>
            <td class="num">${fmtNum(r.k.total)}</td>
            <td class="num"><span class="pill ${complianceTone(r.k.slaCompliance) === 'good' ? 'pill-good' : complianceTone(r.k.slaCompliance) === 'warn' ? 'pill-warn' : 'pill-bad'}">${r.k.slaCompliance == null ? '—' : fmtPct(r.k.slaCompliance)}</span></td>
            <td class="num">${r.k.avgTat == null ? '—' : r.k.avgTat.toFixed(1)}</td>
            <td class="num">${fmtNum(r.k.breach)}</td>
            <td class="num">${r.k.avgVsTarget == null ? '—' : fmtSigned(r.k.avgVsTarget,1)}</td>
            <td class="num">${fmtNum(r.k.open)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function buildYoYMultiCharts(all, cur, pr) {
  // Compute KPIs for every year on record
  const years = [...new Set(all.map(r => r._year).filter(y => y))].sort();
  const rows = years.map(y => {
    const sub = all.filter(r => r._year === y);
    const k = computeKPIs(sub);
    return {
      y,
      volume: k.total,
      compliance: k.slaCompliance == null ? null : k.slaCompliance * 100,
      tat: k.avgTat,
      breaches: k.breach,
      vsTarget: k.avgVsTarget
    };
  });

  // Color bars: current year = burnt orange, prior = steel blue, others = muted grey
  const colorFor = (y) => y === cur ? C.burnt : (y === pr ? C.steel : '#B8C2CC');
  const barColors = rows.map(r => colorFor(r.y));
  const labels = rows.map(r => String(r.y));
  const opt = chartDefaults();

  // Common options for the small charts
  const smallChartOpts = (titleText, valueFormat, suggestedMin) => ({
    ...opt,
    plugins: {
      ...opt.plugins,
      legend: { display: false },
      tooltip: {
        ...opt.plugins.tooltip,
        callbacks: {
          label: (ctx) => valueFormat ? valueFormat(ctx.parsed.y) : String(ctx.parsed.y)
        }
      }
    },
    scales: {
      x: opt.scales.x,
      y: {
        ...opt.scales.y,
        beginAtZero: suggestedMin === undefined,
        ...(suggestedMin !== undefined && { suggestedMin })
      }
    }
  });

  // 1) Volume by year
  STATE.charts.yoyVolume = new Chart($('#ch-yoy-volume').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Requests', data: rows.map(r => r.volume), backgroundColor: barColors, borderRadius: 4 }]
    },
    options: smallChartOpts('Requests', (v) => `${v} requests`)
  });

  // 2) Compliance % by year
  STATE.charts.yoyCompliance = new Chart($('#ch-yoy-compliance').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Compliance %', data: rows.map(r => r.compliance), backgroundColor: barColors, borderRadius: 4 }]
    },
    options: {
      ...smallChartOpts('Compliance %', (v) => `${v == null ? '—' : v.toFixed(1)}%`),
      scales: {
        x: opt.scales.x,
        y: { ...opt.scales.y, beginAtZero: true, max: 100, ticks: { ...opt.scales.y.ticks, callback: v => v + '%' } }
      }
    }
  });

  // 3) Avg response TAT by year
  STATE.charts.yoyTat = new Chart($('#ch-yoy-tat').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Avg TAT (hrs)', data: rows.map(r => r.tat), backgroundColor: barColors, borderRadius: 4 }]
    },
    options: smallChartOpts('Avg TAT (hrs)', (v) => `${v == null ? '—' : v.toFixed(1)} hrs`)
  });

  // 4) SLA Breaches by year
  STATE.charts.yoyBreaches = new Chart($('#ch-yoy-breaches').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Breaches', data: rows.map(r => r.breaches), backgroundColor: rows.map(r => r.y === cur || r.y === pr ? colorFor(r.y) : C.brick), borderRadius: 4 }]
    },
    options: smallChartOpts('Breaches', (v) => `${v} breaches`)
  });

  // 5) Response vs Target by year — color logic differs: negative=good (sage), positive=bad (brick)
  // But current/prior years still highlighted
  const vsTargetColors = rows.map(r => {
    if (r.y === cur) return C.burnt;
    if (r.y === pr) return C.steel;
    return r.vsTarget != null && r.vsTarget <= 0 ? C.sage : C.brick;
  });
  STATE.charts.yoyVsTarget = new Chart($('#ch-yoy-vstarget').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Response vs target (hrs)', data: rows.map(r => r.vsTarget), backgroundColor: vsTargetColors, borderRadius: 4 }]
    },
    options: {
      ...smallChartOpts('Response vs target (hrs)', (v) => `${v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1)} hrs`),
      scales: {
        x: opt.scales.x,
        y: {
          ...opt.scales.y,
          beginAtZero: false,
          grid: { ...opt.scales.y.grid, color: (ctx) => ctx.tick.value === 0 ? '#1F2937' : C.line, lineWidth: (ctx) => ctx.tick.value === 0 ? 1.5 : 1 }
        }
      }
    }
  });
}

// ====== SLA ANALYSIS PAGE ======
function renderSLA() {
  buildFilterBar();
  const records = applyFilters(enrichedAll());

  const byField = (field, items) => items.map(it => {
    const sub = records.filter(r => r[field] === it);
    const c = sub.filter(r => r._slaCompliant === 'Compliant').length;
    const b = sub.filter(r => r._slaCompliant === 'Breached').length;
    const tot = c + b;
    const validTat = sub.filter(r => r._tatValid);
    const avgT = validTat.length ? validTat.reduce((a,r)=>a+r._responseTAT,0) / validTat.length : null;
    return { name: it, total: sub.length, c, b, compRate: tot ? c/tot : null, avgT };
  });

  const priorities = ['Critical (6 Hours)','High (1 Working day)','Medium (3 Working days)','Low (5 Working days)'];
  const byPriority = byField('priority', priorities);
  const byRegion   = byField('region', STATE.dropdowns.Region || ['Kuwait','Middle East','Latin America','Africa']);

  // By Owner — top 10
  const owners = [...new Set(records.map(r => r.resolved_by).filter(Boolean))];
  const byOwnerAll = byField('resolved_by', owners).sort((a,b) => b.total - a.total).slice(0,10);

  const renderRow = (r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${fmtNum(r.total)}</td>
      <td class="num">${fmtNum(r.c)}</td>
      <td class="num">${fmtNum(r.b)}</td>
      <td class="num"><span class="pill ${complianceTone(r.compRate) === 'good' ? 'pill-good' : complianceTone(r.compRate) === 'warn' ? 'pill-warn' : 'pill-bad'}">${r.compRate == null ? '—' : fmtPct(r.compRate)}</span></td>
      <td class="num">${r.avgT == null ? '—' : r.avgT.toFixed(1)}</td>
    </tr>`;

  const tableHTML = (rows, label='Priority') => `
    <table class="tbl">
      <thead><tr><th>${label}</th><th class="num">Total</th><th class="num">Compliant</th><th class="num">Breached</th><th class="num">Compliance %</th><th class="num">Avg TAT (hrs)</th></tr></thead>
      <tbody>${rows.map(renderRow).join('')}</tbody>
    </table>`;

  $('#page').innerHTML = `
    <div class="section">
      <div class="section-head"><div class="section-title">By priority</div></div>
      <div class="panel"><div class="table-wrap">${tableHTML(byPriority, 'Priority')}</div></div>
    </div>
    <div class="section">
      <div class="section-head"><div class="section-title">By region</div></div>
      <div class="panel"><div class="table-wrap">${tableHTML(byRegion, 'Region')}</div></div>
    </div>
    <div class="section">
      <div class="section-head"><div class="section-title">Top 10 owners by volume</div></div>
      <div class="panel"><div class="table-wrap">${tableHTML(byOwnerAll, 'Owner')}</div></div>
    </div>
  `;
  setupFilterListeners();
}

// ====== MTTR PAGE ======
function renderMTTR() {
  buildFilterBar();
  const records = applyFilters(enrichedAll());

  const stats = (sub) => {
    const valid = sub.filter(r => r._mttrValid);
    if (!valid.length) return { count: sub.length, avg: null, min: null, max: null, validCount: 0 };
    const vals = valid.map(r => r._mttr);
    return {
      count: sub.length,
      validCount: vals.length,
      avg: vals.reduce((a,b)=>a+b,0) / vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals)
    };
  };

  const priorities = ['Critical (6 Hours)','High (1 Working day)','Medium (3 Working days)','Low (5 Working days)'];
  const byPri = priorities.map(p => ({ name: p, ...stats(records.filter(r => r.priority === p)), target: DEFAULT_SLA[p] }));

  const regions = STATE.dropdowns.Region || ['Kuwait','Middle East','Latin America','Africa'];
  const byReg = regions.map(rg => ({ name: rg, ...stats(records.filter(r => r.region === rg)) }));

  const cats = [...new Set(records.map(r => r.category).filter(Boolean))];
  const byCat = cats.map(c => ({ name: c, ...stats(records.filter(r => r.category === c)) }));

  const renderRow = (r, showTarget=false) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${fmtNum(r.count)}</td>
      <td class="num">${r.avg == null ? '—' : r.avg.toFixed(1)}</td>
      <td class="num">${r.min == null ? '—' : r.min.toFixed(1)}</td>
      <td class="num">${r.max == null ? '—' : r.max.toFixed(1)}</td>
      ${showTarget ? `<td class="num">${fmtNum(r.target)}</td>` : ''}
    </tr>`;

  $('#page').innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title">MTTR by priority</div>
        <div class="section-note">Excludes records with missing acceptance date or invalid timestamps</div>
      </div>
      <div class="panel"><div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Priority</th><th class="num">Records</th><th class="num">Avg MTTR (hrs)</th><th class="num">Min</th><th class="num">Max</th><th class="num">SLA target (hrs)</th></tr></thead>
          <tbody>${byPri.map(r => renderRow(r, true)).join('')}</tbody>
        </table>
      </div></div>
    </div>
    <div class="section">
      <div class="section-head"><div class="section-title">MTTR by region</div></div>
      <div class="panel"><div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Region</th><th class="num">Records</th><th class="num">Avg MTTR (hrs)</th><th class="num">Min</th><th class="num">Max</th></tr></thead>
          <tbody>${byReg.map(r => renderRow(r)).join('')}</tbody>
        </table>
      </div></div>
    </div>
    <div class="section">
      <div class="section-head"><div class="section-title">MTTR by category</div></div>
      <div class="panel"><div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Category</th><th class="num">Records</th><th class="num">Avg MTTR (hrs)</th><th class="num">Min</th><th class="num">Max</th></tr></thead>
          <tbody>${byCat.map(r => renderRow(r)).join('')}</tbody>
        </table>
      </div></div>
    </div>
  `;
  setupFilterListeners();
}

// ====== VOLUME TRENDS PAGE ======
function renderVolume() {
  buildFilterBar();
  const records = applyFilters(enrichedAll());

  $('#page').innerHTML = `
    <div class="section">
      <div class="section-head"><div class="section-title">Monthly volume</div></div>
      <div class="panel"><div class="chart-box lg"><canvas id="ch-monthly"></canvas></div></div>
    </div>
    <div class="section">
      <div class="section-head"><div class="section-title">Distribution</div></div>
      <div class="grid-3">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">By category</div></div>
          <div class="chart-box"><canvas id="ch-cat"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">By priority</div></div>
          <div class="chart-box"><canvas id="ch-pri-mix"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">By region</div></div>
          <div class="chart-box"><canvas id="ch-reg-mix"></canvas></div>
        </div>
      </div>
    </div>
  `;

  buildMonthlyVolumeChart(records);
  buildCategoryChart(records);
  buildPriorityMixChart(records);
  buildRegionMixChart(records);
  setupFilterListeners();
}

function buildMonthlyVolumeChart(records) {
  const months = {};
  records.forEach(r => { if (r._yearMonth) months[r._yearMonth] = (months[r._yearMonth]||0) + 1; });
  const labels = Object.keys(months).sort();
  const ctx = $('#ch-monthly').getContext('2d');
  STATE.charts.monthly = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Requests',
        data: labels.map(l => months[l]),
        borderColor: C.steel,
        backgroundColor: 'rgba(61, 107, 145, 0.15)',
        tension: 0.3,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        spanGaps: true
      }]
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ...chartDefaults().scales.x, ticks: { ...chartDefaults().scales.x.ticks, maxRotation: 45, autoSkip: true, maxTicksLimit: 16 } },
        y: { ...chartDefaults().scales.y, beginAtZero: true }
      }
    }
  });
}

function donutData(records, field) {
  const counts = {};
  records.forEach(r => { const v = r[field] || '—'; counts[v] = (counts[v]||0) + 1; });
  return Object.entries(counts).sort((a,b) => b[1]-a[1]);
}

function buildCategoryChart(records) {
  const data = donutData(records, 'category');
  const ctx = $('#ch-cat').getContext('2d');
  STATE.charts.cat = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: data.map(d => d[0]), datasets: [{ data: data.map(d => d[1]), backgroundColor: [C.steel, C.burnt, C.sage, C.amber, C.brick, C.ink] }] },
    options: { ...chartDefaults(), scales: {}, plugins: { ...chartDefaults().plugins, legend: { position: 'right' } } }
  });
}

function buildPriorityMixChart(records) {
  const data = donutData(records, 'priority');
  const ctx = $('#ch-pri-mix').getContext('2d');
  STATE.charts.priMix = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: data.map(d => d[0]), datasets: [{ data: data.map(d => d[1]), backgroundColor: [C.brick, C.amber, C.steel, C.sage] }] },
    options: { ...chartDefaults(), scales: {}, plugins: { ...chartDefaults().plugins, legend: { position: 'right' } } }
  });
}

function buildRegionMixChart(records) {
  const data = donutData(records, 'region');
  const ctx = $('#ch-reg-mix').getContext('2d');
  STATE.charts.regMix = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{ data: data.map(d => d[1]), backgroundColor: [C.steel, C.burnt, C.sage, C.amber, C.brick], borderRadius: 4 }]
    },
    options: { ...chartDefaults(), indexAxis: 'y', plugins: { ...chartDefaults().plugins, legend: { display: false } } }
  });
}

// ====== WORKLOAD PAGE ======
function renderWorkload() {
  buildFilterBar();
  const records = applyFilters(enrichedAll());

  const buckets = ['0-7 days','8-14 days','15-30 days','31-90 days','>90 days'];
  const ageStats = buckets.map(b => {
    const sub = records.filter(r => r._ageBucket === b);
    return { name: b, count: sub.length, open: sub.filter(r => r._isOpen).length };
  });

  const owners = [...new Set(records.map(r => r.resolved_by).filter(Boolean))];
  const ownerStats = owners.map(o => {
    const sub = records.filter(r => r.resolved_by === o);
    const c = sub.filter(r => r._slaCompliant === 'Compliant').length;
    const b = sub.filter(r => r._slaCompliant === 'Breached').length;
    return { name: o, total: sub.length, c, b, compRate: (c+b) > 0 ? c/(c+b) : null, open: sub.filter(r => r._isOpen).length };
  }).sort((a,b) => b.total - a.total).slice(0,15);

  $('#page').innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title">Aging distribution</div>
        <div class="section-note">All requests by age bucket</div>
      </div>
      <div class="panel"><div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Bucket</th><th class="num">Total records</th><th class="num">Open</th><th class="num">% of total</th></tr></thead>
          <tbody>${ageStats.map(s => `
            <tr>
              <td>${escapeHtml(s.name)}</td>
              <td class="num">${fmtNum(s.count)}</td>
              <td class="num">${fmtNum(s.open)}</td>
              <td class="num">${records.length ? fmtPct(s.count / records.length) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div></div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Owner workload (top 15)</div>
      </div>
      <div class="panel"><div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Owner</th><th class="num">Total</th><th class="num">Compliant</th><th class="num">Breached</th><th class="num">Compliance %</th><th class="num">Open</th></tr></thead>
          <tbody>${ownerStats.map(s => `
            <tr>
              <td>${escapeHtml(s.name)}</td>
              <td class="num">${fmtNum(s.total)}</td>
              <td class="num">${fmtNum(s.c)}</td>
              <td class="num">${fmtNum(s.b)}</td>
              <td class="num"><span class="pill ${complianceTone(s.compRate) === 'good' ? 'pill-good' : complianceTone(s.compRate) === 'warn' ? 'pill-warn' : 'pill-bad'}">${s.compRate == null ? '—' : fmtPct(s.compRate)}</span></td>
              <td class="num">${fmtNum(s.open)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div></div>
    </div>
  `;
  setupFilterListeners();
}

// ====== PRIORITY MATRIX ======
function renderMatrix() {
  const all = enrichedAll().filter(r => r._includeKPI);

  const matrix = [
    { prio: 'Critical', color: C.brick, sla: '≤ 6 Hours', impact: 'Immediate risk to safety, well integrity, or major production loss', cases: 'Active operations (Rig-Up/Running) · NPT/LD impact · Well control risk · Equipment failure risk', match: 'Critical (6 Hours)', targetHrs: 6 },
    { prio: 'High', color: C.burnt, sla: '≤ 1 Working day', impact: 'Significant production or commercial impact (no immediate risk)', cases: 'Production reduction · Field troubleshooting · Urgent client deliverables · Opportunity blockers', match: 'High (1 Working day)', targetHrs: 24 },
    { prio: 'Medium', color: C.amber, sla: '≤ 3 Working days', impact: 'Normal technical support with no operational urgency', cases: 'Engineering clarifications · Design support · Optimization studies', match: 'Medium (3 Working days)', targetHrs: 72 },
    { prio: 'Low', color: C.sage, sla: '≤ 5 Working days', impact: 'Non-operational / long-term value activities', cases: 'Tenders · RCFA · Documentation · Process improvement · Training', match: 'Low (5 Working days)', targetHrs: 120 }
  ];

  const rows = matrix.map(m => {
    const sub = all.filter(r => r.priority === m.match);
    const validTat = sub.filter(r => r._tatValid);
    const avg = validTat.length ? validTat.reduce((a,r)=>a+r._responseTAT,0) / validTat.length : null;
    const c = sub.filter(r => r._slaCompliant === 'Compliant').length;
    const b = sub.filter(r => r._slaCompliant === 'Breached').length;
    return { ...m, avg, c, b, total: sub.length, compRate: (c+b) > 0 ? c/(c+b) : null };
  });

  $('#page').innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title">Priority framework</div>
        <div class="section-note">Governance reference · SLA targets · Business impact · Typical use cases</div>
      </div>
      <div class="panel">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr><th></th><th>Priority</th><th>Response time (SLA)</th><th>Business impact</th><th>Typical use cases</th></tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td style="width:32px;"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${r.color};vertical-align:middle;"></span></td>
                  <td><strong style="color:${r.color}">${r.prio}</strong></td>
                  <td><strong>${r.sla}</strong></td>
                  <td>${escapeHtml(r.impact)}</td>
                  <td>${escapeHtml(r.cases)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Current performance against the matrix</div>
        <div class="section-note">Lifetime data, all records included</div>
      </div>
      <div class="panel">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr><th></th><th>Priority</th><th class="num">Target</th><th class="num">Actual avg response (hrs)</th><th class="num">Records</th><th class="num">Compliance %</th></tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td style="width:32px;"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${r.color};vertical-align:middle;"></span></td>
                  <td><strong>${r.prio}</strong></td>
                  <td class="num">${r.targetHrs} hrs</td>
                  <td class="num">${r.avg == null ? '—' : r.avg.toFixed(1) + ' hrs'}</td>
                  <td class="num">${fmtNum(r.total)}</td>
                  <td class="num"><span class="pill ${complianceTone(r.compRate) === 'good' ? 'pill-good' : complianceTone(r.compRate) === 'warn' ? 'pill-warn' : 'pill-bad'}">${r.compRate == null ? '—' : fmtPct(r.compRate)}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ====== ALL RECORDS PAGE ======
let recordsTableState = { sortField: '_created', sortDir: 'desc', search: '' };

function renderRecords() {
  const records = enrichedAll();

  const html = `
    <div class="section">
      <div class="panel">
        <div class="flex-between mb-16" style="margin-bottom:16px;">
          <input type="text" class="search-box" id="records-search" placeholder="Search title, customer, owner, ID…" value="${escapeHtml(recordsTableState.search)}">
          <div class="flex gap-8">
            <button class="btn-ghost" id="export-csv">Export CSV</button>
            <button class="btn-ghost" id="export-xlsx">Export Excel</button>
          </div>
        </div>
        <div class="table-wrap" id="records-table-wrap"></div>
      </div>
    </div>
  `;
  $('#page').innerHTML = html;

  const draw = () => {
    let rs = records.slice();
    if (recordsTableState.search) {
      const q = recordsTableState.search.toLowerCase();
      rs = rs.filter(r => 
        (r.id || '').toLowerCase().includes(q) ||
        (r.request_title || '').toLowerCase().includes(q) ||
        (r.customer || '').toLowerCase().includes(q) ||
        (r.resolved_by || '').toLowerCase().includes(q) ||
        (r.region || '').toLowerCase().includes(q) ||
        (r.country || '').toLowerCase().includes(q)
      );
    }
    rs.sort((a,b) => {
      const f = recordsTableState.sortField;
      let va = a[f], vb = b[f];
      if (va instanceof Date) va = va.getTime();
      if (vb instanceof Date) vb = vb.getTime();
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      const dir = recordsTableState.sortDir === 'asc' ? 1 : -1;
      return va < vb ? -dir : va > vb ? dir : 0;
    });

    const header = (label, field) => {
      const cls = recordsTableState.sortField === field ? `sort-${recordsTableState.sortDir}` : '';
      return `<th class="${cls}" data-field="${field}">${label}</th>`;
    };

    const html2 = `
      <table class="tbl">
        <thead>
          <tr>
            ${header('Date', '_created')}
            ${header('ID', 'id')}
            ${header('Customer', 'customer')}
            ${header('Region', 'region')}
            ${header('Priority', 'priority')}
            ${header('Title', 'request_title')}
            ${header('Owner', 'resolved_by')}
            ${header('SLA', '_slaCompliant')}
            ${header('TAT', '_responseTAT')}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rs.slice(0, 500).map(r => `
            <tr>
              <td class="mono text-small">${fmtDate(r._created, {short: true})}</td>
              <td class="mono text-small">${escapeHtml(r.id || '—')}</td>
              <td>${escapeHtml((r.customer || '—').slice(0,30))}</td>
              <td>${escapeHtml(r.region || '—')}</td>
              <td>${escapeHtml(r.priority ? r.priority.split(' ')[0] : '—')}</td>
              <td>${escapeHtml((r.request_title || '—').slice(0,40))}</td>
              <td>${escapeHtml((r.resolved_by || '—').slice(0,20))}</td>
              <td>${slaPill(r._slaCompliant)}</td>
              <td class="num mono">${r._responseTAT == null ? '—' : r._responseTAT.toFixed(1)}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-btn" data-action="view" data-id="${r.id}" title="View">👁</button>
                  <button class="icon-btn" data-action="edit" data-id="${r.id}" title="Edit (admin)">✎</button>
                  <button class="icon-btn icon-danger" data-action="delete" data-id="${r.id}" title="Delete (admin)">🗑</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${rs.length > 500 ? `<div style="padding:12px;text-align:center;color:var(--text-3);font-size:12px;">Showing first 500 of ${rs.length} results. Refine search to see more.</div>` : ''}
    `;
    $('#records-table-wrap').innerHTML = html2;

    $$('#records-table-wrap th[data-field]').forEach(th => {
      th.addEventListener('click', () => {
        const f = th.dataset.field;
        if (recordsTableState.sortField === f) {
          recordsTableState.sortDir = recordsTableState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          recordsTableState.sortField = f;
          recordsTableState.sortDir = 'asc';
        }
        draw();
      });
    });

    $$('#records-table-wrap button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'view') openRecordModal(id, false);
        if (action === 'edit') {
          requireAdmin(() => openRecordModal(id, true));
        }
        if (action === 'delete') {
          requireAdmin(() => deleteRecord(id));
        }
      });
    });
  };

  $('#records-search').addEventListener('input', e => {
    recordsTableState.search = e.target.value;
    draw();
  });

  $('#export-csv').addEventListener('click', () => exportCSV());
  $('#export-xlsx').addEventListener('click', () => exportXLSX());

  draw();
}

function slaPill(status) {
  if (status === 'Compliant') return '<span class="pill pill-good">Compliant</span>';
  if (status === 'Breached')  return '<span class="pill pill-bad">Breached</span>';
  return '<span class="pill pill-muted">—</span>';
}

// ====== NEW / EDIT TICKET MODAL ======
function renderNewTicket() {
  $('#page').innerHTML = '';
  openRecordModal(null, true); // null id = new record, true = editable
}

function openRecordModal(id, editable=false) {
  const isNew = !id;
  const rec = isNew ? {
    id: '', region: '', country: '', customer: '', request_title: '', priority: '',
    status_reason: '', response_done: '', category: '', sub_category: '',
    created_by: '', resolved_by: '', sla_status: '',
    created_on: new Date().toISOString().slice(0,10), response_date: '', acceptance_date: '',
    request_type: '', cost_optimized: '', npt_reduction: '', production_recovery: '',
    request_description: '', attachment_url: ''
  } : STATE.records.find(r => r.id === id);

  if (!rec) { toast('Record not found', 'error'); return; }

  // If editing existing, require admin first
  if (!isNew && editable && !STATE.isAdmin) {
    requireAdmin(() => openRecordModal(id, true));
    return;
  }

  const D = STATE.dropdowns;
  const opt = (val, list) => `<option value="">—</option>` + list.map(o => `<option value="${escapeHtml(o)}" ${o===val?'selected':''}>${escapeHtml(o)}</option>`).join('');

  const ro = editable ? '' : 'readonly disabled';

  const html = `
    <div class="modal" id="rec-modal">
      <div class="modal-card">
        <div class="modal-title">${isNew ? 'New ticket' : (editable ? 'Edit ticket' : 'View ticket')}</div>
        <p class="modal-body">${isNew ? 'Add a new technical request. Fields with required data are marked.' : `ID: ${escapeHtml(rec.id || '—')}`}</p>

        <div class="form-grid cols-3">
          <div class="field">
            <label>Request ID${isNew ? ' (auto)' : ''}</label>
            <input type="text" id="f-id" value="${escapeHtml(rec.id || '')}" ${isNew ? 'placeholder="auto-generated"' : ro}>
          </div>
          <div class="field">
            <label>Country</label>
            <select id="f-country" ${ro}>${opt(rec.country, D.Country || [])}</select>
          </div>
          <div class="field">
            <label>Region</label>
            <select id="f-region" ${ro}>${opt(rec.region, D.Region || [])}</select>
          </div>

          <div class="field field-full">
            <label>Request title</label>
            <input type="text" id="f-title" value="${escapeHtml(rec.request_title || '')}" ${ro}>
          </div>

          <div class="field">
            <label>Customer</label>
            <select id="f-customer" ${ro}>${opt(rec.customer, D.Customer || [])}</select>
          </div>
          <div class="field">
            <label>Priority</label>
            <select id="f-priority" ${ro}>${opt(rec.priority, D.Priority || [])}</select>
          </div>
          <div class="field">
            <label>Request type</label>
            <select id="f-type" ${ro}>${opt(rec.request_type, D.RequestType || [])}</select>
          </div>

          <div class="field">
            <label>Category</label>
            <select id="f-category" ${ro}>${opt(rec.category, D.Category || [])}</select>
          </div>
          <div class="field">
            <label>Sub-category</label>
            <select id="f-subcategory" ${ro}>${opt(rec.sub_category, D.SubCategory || [])}</select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="f-status" ${ro}>${opt(rec.status_reason, D.StatusReason || [])}</select>
          </div>

          <div class="field">
            <label>Requester</label>
            <select id="f-createdby" ${ro}>${opt(rec.created_by, D.CreatedBy || [])}</select>
          </div>
          <div class="field">
            <label>Resolved by</label>
            <select id="f-resolvedby" ${ro}>${opt(rec.resolved_by, D.ResolvedBy || [])}</select>
          </div>
          <div class="field">
            <label>Response done</label>
            <select id="f-respdone" ${ro}>${opt(rec.response_done, D.ResponseDone || [])}</select>
          </div>

          <div class="field">
            <label>Created on</label>
            <input type="date" id="f-created" value="${(rec.created_on||'').slice(0,10)}" ${ro}>
          </div>
          <div class="field">
            <label>Response date</label>
            <input type="date" id="f-response" value="${(rec.response_date||'').slice(0,10)}" ${ro}>
          </div>
          <div class="field">
            <label>Acceptance date</label>
            <input type="date" id="f-acceptance" value="${(rec.acceptance_date||'').slice(0,10)}" ${ro}>
          </div>

          <div class="field">
            <label>SLA outcome</label>
            <select id="f-slastatus" ${ro}>${opt(rec.sla_status, D.SLAStatus || [])}</select>
          </div>
          <div class="field">
            <label>Cost optimized</label>
            <select id="f-cost" ${ro}>${opt(rec.cost_optimized, D.ImpactFlag || [])}</select>
          </div>
          <div class="field">
            <label>NPT reduction</label>
            <select id="f-npt" ${ro}>${opt(rec.npt_reduction, D.ImpactFlag || [])}</select>
          </div>

          <div class="field">
            <label>Production recovery</label>
            <select id="f-prod" ${ro}>${opt(rec.production_recovery, D.ImpactFlag || [])}</select>
          </div>
          <div class="field field-full" style="grid-column: span 2;">
            <label>Attachment URL (optional)</label>
            <input type="url" id="f-attachment" value="${escapeHtml(rec.attachment_url || '')}" placeholder="https://..." ${ro}>
          </div>

          <div class="field field-full">
            <label>Description</label>
            <textarea id="f-desc" ${ro}>${escapeHtml(rec.request_description || '')}</textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-ghost" id="rec-close">${editable ? 'Cancel' : 'Close'}</button>
          ${editable ? `<button class="btn-primary" id="rec-save">${isNew ? 'Create ticket' : 'Save changes'}</button>` : ''}
        </div>
      </div>
    </div>
  `;

  // Use a temp container so the modal layers nicely
  let existing = $('#rec-modal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);

  $('#rec-close').addEventListener('click', () => { $('#rec-modal').remove(); });

  // Country → Region auto-fill
  $('#f-country').addEventListener('change', e => {
    const c = e.target.value;
    if (COUNTRY_TO_REGION[c]) $('#f-region').value = COUNTRY_TO_REGION[c];
  });

  if (editable) {
    $('#rec-save').addEventListener('click', () => saveRecord(isNew, rec.id));
  }
}

function saveRecord(isNew, existingId) {
  const data = {
    id: isNew ? ('THR-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5)) : ($('#f-id').value || existingId),
    region: $('#f-region').value,
    country: $('#f-country').value,
    customer: $('#f-customer').value,
    request_title: $('#f-title').value,
    priority: $('#f-priority').value,
    status_reason: $('#f-status').value,
    response_done: $('#f-respdone').value,
    category: $('#f-category').value,
    sub_category: $('#f-subcategory').value,
    created_by: $('#f-createdby').value,
    resolved_by: $('#f-resolvedby').value,
    sla_status: $('#f-slastatus').value,
    created_on: $('#f-created').value,
    response_date: $('#f-response').value,
    acceptance_date: $('#f-acceptance').value,
    request_type: $('#f-type').value,
    cost_optimized: $('#f-cost').value,
    npt_reduction: $('#f-npt').value,
    production_recovery: $('#f-prod').value,
    request_description: $('#f-desc').value,
    attachment_url: $('#f-attachment').value
  };

  if (!data.request_title) { toast('Request title is required', 'error'); return; }
  if (!data.created_on) { toast('Created date is required', 'error'); return; }

  if (isNew) {
    STATE.records.push(data);
    toast('Ticket created', 'ok');
  } else {
    const idx = STATE.records.findIndex(r => r.id === existingId);
    if (idx >= 0) {
      STATE.records[idx] = data;
      toast('Ticket updated', 'ok');
    }
  }
  saveRecords();
  $('#rec-modal').remove();
  location.hash = '#/records';
}

function deleteRecord(id) {
  if (!confirm('Delete this ticket permanently? This cannot be undone.')) return;
  STATE.records = STATE.records.filter(r => r.id !== id);
  saveRecords();
  toast('Ticket deleted', 'ok');
  renderPage(STATE.currentPage);
}

// ====== ADMIN GATE ======
function requireAdmin(onSuccess) {
  if (STATE.isAdmin) { onSuccess(); return; }
  openAdminGate(onSuccess);
}

function openAdminGate(onSuccess) {
  const modal = $('#admin-gate');
  modal.classList.remove('hidden');
  const pwd = $('#admin-pwd');
  pwd.value = '';
  pwd.focus();
  $('#admin-err').textContent = '';

  const submit = () => {
    if (pwd.value === PWD_ADMIN) {
      STATE.isAdmin = true;
      modal.classList.add('hidden');
      pwd.removeEventListener('keydown', onKey);
      onSuccess && onSuccess();
    } else {
      $('#admin-err').textContent = 'Incorrect password.';
      pwd.value = '';
    }
  };
  const cancel = () => {
    modal.classList.add('hidden');
    pwd.removeEventListener('keydown', onKey);
    // Navigate back if they cancelled on settings page
    if (STATE.currentPage === 'settings') location.hash = '#/dashboard';
  };
  const onKey = (e) => { if (e.key === 'Enter') submit(); };
  pwd.addEventListener('keydown', onKey);
  $('#admin-submit').onclick = submit;
  $('#admin-cancel').onclick = cancel;
}

// ====== SETTINGS PAGE ======
function renderSettings() {
  let activeTab = 'dropdowns';
  let activeList = 'Region';

  const drawTabs = () => {
    const html = `
      <div class="tab-bar">
        <button class="tab-btn ${activeTab==='dropdowns'?'active':''}" data-tab="dropdowns">Dropdowns</button>
        <button class="tab-btn ${activeTab==='data'?'active':''}" data-tab="data">Data import / export</button>
        <button class="tab-btn ${activeTab==='reset'?'active':''}" data-tab="reset">Reset &amp; logout</button>
      </div>
      <div id="settings-body"></div>
    `;
    $('#page').innerHTML = html;
    $$('.tab-btn').forEach(b => {
      b.addEventListener('click', () => { activeTab = b.dataset.tab; drawTabs(); drawTabBody(); });
    });
    drawTabBody();
  };

  const drawTabBody = () => {
    if (activeTab === 'dropdowns') drawDropdowns();
    if (activeTab === 'data') drawDataTab();
    if (activeTab === 'reset') drawResetTab();
  };

  const drawDropdowns = () => {
    const D = STATE.dropdowns;
    const lists = Object.keys(D);

    const html = `
      <div class="list-mgr">
        <div class="list-mgr-side">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-3);margin-bottom:8px;">Lists</div>
          ${lists.map(l => `<button class="${l===activeList?'active':''}" data-list="${l}">${l}</button>`).join('')}
        </div>
        <div>
          <div class="flex-between" style="margin-bottom:12px;">
            <div style="font-size:14px;font-weight:600;">${escapeHtml(activeList)} (${D[activeList].length})</div>
            <div class="flex gap-8">
              <input type="text" class="search-box" id="new-val" placeholder="Add new value…" style="width:200px;">
              <button class="btn-primary" id="add-val">Add</button>
            </div>
          </div>
          <div id="val-list">
            ${D[activeList].map((v,i) => `
              <div class="value-item">
                <input type="text" value="${escapeHtml(v)}" data-idx="${i}">
                <button data-del="${i}" title="Delete">×</button>
              </div>`).join('')}
          </div>
        </div>
      </div>
    `;
    $('#settings-body').innerHTML = html;

    $$('button[data-list]').forEach(b => {
      b.addEventListener('click', () => { activeList = b.dataset.list; drawDropdowns(); });
    });
    $('#add-val').addEventListener('click', () => {
      const v = $('#new-val').value.trim();
      if (!v) return;
      if (!D[activeList].includes(v)) {
        D[activeList].push(v);
        D[activeList].sort();
        saveDropdowns();
        drawDropdowns();
        toast('Added', 'ok');
      } else {
        toast('Value already exists', 'error');
      }
    });
    $$('input[data-idx]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        D[activeList][idx] = inp.value.trim();
        saveDropdowns();
        toast('Updated', 'ok');
      });
    });
    $$('button[data-del]').forEach(b => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.del);
        if (!confirm(`Remove "${D[activeList][idx]}"?`)) return;
        D[activeList].splice(idx, 1);
        saveDropdowns();
        drawDropdowns();
        toast('Removed', 'ok');
      });
    });
  };

  const drawDataTab = () => {
    const html = `
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Import CSV</div></div>
        <p class="text-mute text-small mt-8" style="margin-bottom:12px;">Upload a CSV file to replace or append to the current dataset. Required columns: id, request_title, created_on, priority, region. Other columns optional.</p>
        <div class="flex gap-8">
          <input type="file" id="csv-file" accept=".csv">
          <button class="btn-ghost" id="csv-append">Append</button>
          <button class="btn-danger" id="csv-replace">Replace all</button>
        </div>
      </div>

      <div class="panel mt-16">
        <div class="panel-head"><div class="panel-title">Export</div></div>
        <p class="text-mute text-small mt-8" style="margin-bottom:12px;">Download a backup of all current data.</p>
        <div class="flex gap-8">
          <button class="btn-primary" id="exp-csv-set">Export CSV</button>
          <button class="btn-primary" id="exp-xlsx-set">Export Excel</button>
        </div>
      </div>

      <div class="panel mt-16">
        <div class="panel-head"><div class="panel-title">Storage status</div></div>
        <div class="kpi-grid">
          ${kpiCardHTML('Total records', fmtNum(STATE.records.length))}
          ${kpiCardHTML('Storage used', fmtStorage())}
        </div>
      </div>
    `;
    $('#settings-body').innerHTML = html;

    $('#csv-append').addEventListener('click', () => importCSV(false));
    $('#csv-replace').addEventListener('click', () => importCSV(true));
    $('#exp-csv-set').addEventListener('click', () => exportCSV());
    $('#exp-xlsx-set').addEventListener('click', () => exportXLSX());
  };

  const drawResetTab = () => {
    const html = `
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Admin session</div></div>
        <p class="text-mute text-small mt-8" style="margin-bottom:12px;">You are currently signed in as Admin. Sign out to require the admin password again.</p>
        <button class="btn-ghost" id="logout-admin">Sign out admin</button>
      </div>

      <div class="panel mt-16">
        <div class="panel-head"><div class="panel-title" style="color:var(--brick)">Danger zone</div></div>
        <p class="text-mute text-small mt-8" style="margin-bottom:12px;">Permanently delete all records and reset dropdowns to defaults. Export your data first.</p>
        <button class="btn-danger" id="reset-all">Reset everything</button>
      </div>
    `;
    $('#settings-body').innerHTML = html;

    $('#logout-admin').addEventListener('click', () => {
      STATE.isAdmin = false;
      toast('Admin session ended', 'ok');
      location.hash = '#/dashboard';
    });
    $('#reset-all').addEventListener('click', () => {
      if (!confirm('Delete ALL records and dropdowns? This cannot be undone.')) return;
      if (!confirm('Are you absolutely sure?')) return;
      STATE.records = [];
      STATE.dropdowns = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
      saveRecords();
      saveDropdowns();
      toast('All data reset', 'ok');
      location.hash = '#/dashboard';
    });
  };

  drawTabs();
}

function fmtStorage() {
  try {
    let total = 0;
    for (let k in localStorage) total += (localStorage[k] || '').length;
    return (total / 1024).toFixed(1) + ' KB';
  } catch(e) { return '—'; }
}

// ====== CSV IMPORT / EXPORT ======
function importCSV(replace) {
  const file = $('#csv-file').files[0];
  if (!file) { toast('Select a CSV file first', 'error'); return; }
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const rows = results.data.map(r => normalizeImportRow(r));
      const valid = rows.filter(r => r.request_title && r.created_on);
      if (replace) STATE.records = valid;
      else STATE.records = STATE.records.concat(valid);
      saveRecords();
      toast(`Imported ${valid.length} records`, 'ok');
      renderPage('records');
    },
    error: (err) => toast('CSV parse error: ' + err.message, 'error')
  });
}

function normalizeImportRow(r) {
  // Accept multiple column name conventions
  const get = (...keys) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== '') return r[k];
    }
    return '';
  };
  return {
    id: get('id','ID','Request ID') || uid(),
    region: get('region','Region'),
    country: get('country','Country'),
    customer: get('customer','Customer'),
    request_title: get('request_title','Request Title','Title'),
    priority: get('priority','Priority'),
    status_reason: get('status_reason','Status Reason','Status'),
    response_done: get('response_done','Response Done'),
    category: get('category','Category'),
    sub_category: get('sub_category','Sub Category','Sub-Category'),
    created_by: get('created_by','Created By','Requester'),
    resolved_by: get('resolved_by','Resolved By','Owner'),
    sla_status: get('sla_status','SLA Status','Status (Technical Request SLA) (SLA KPI Instance)'),
    created_on: normalizeDate(get('created_on','Created On','Created Date')),
    response_date: normalizeDate(get('response_date','Response Date')),
    acceptance_date: normalizeDate(get('acceptance_date','Acceptance Date')),
    request_type: get('request_type','Request Type'),
    cost_optimized: get('cost_optimized','Cost Optimized'),
    npt_reduction: get('npt_reduction','NPT Reduction'),
    production_recovery: get('production_recovery','Production Recovery'),
    request_description: get('request_description','Request Description','Description'),
    attachment_url: get('attachment_url','Attachment URL','Link')
  };
}

function normalizeDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toISOString().slice(0,10);
}

function exportCSV() {
  const headers = ['id','region','country','customer','request_title','priority','status_reason','response_done','category','sub_category','created_by','resolved_by','sla_status','created_on','response_date','acceptance_date','request_type','cost_optimized','npt_reduction','production_recovery','request_description','attachment_url'];
  const csv = Papa.unparse({ fields: headers, data: STATE.records.map(r => headers.map(h => r[h] || '')) });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  download(blob, `techhub_export_${new Date().toISOString().slice(0,10)}.csv`);
  toast('CSV exported', 'ok');
}

function exportXLSX() {
  const headers = ['ID','Region','Country','Customer','Request Title','Priority','Status','Response Done','Category','Sub-Category','Created By','Resolved By','SLA Status','Created On','Response Date','Acceptance Date','Request Type','Cost Optimized','NPT Reduction','Production Recovery','Description','Attachment URL'];
  const data = [headers, ...STATE.records.map(r => [r.id,r.region,r.country,r.customer,r.request_title,r.priority,r.status_reason,r.response_done,r.category,r.sub_category,r.created_by,r.resolved_by,r.sla_status,r.created_on,r.response_date,r.acceptance_date,r.request_type,r.cost_optimized,r.npt_reduction,r.production_recovery,r.request_description,r.attachment_url])];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tech Hub Records');
  XLSX.writeFile(wb, `techhub_export_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel exported', 'ok');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ====== INITIAL SEED FROM data.csv ======
async function trySeedFromCSV() {
  // If localStorage already has data, skip
  if (STATE.records.length > 0) return;
  try {
    const resp = await fetch('data.csv');
    if (!resp.ok) return;
    const text = await resp.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (!parsed.data || !parsed.data.length) return;
    STATE.records = parsed.data.map(r => normalizeImportRow(r));
    saveRecords();
    // Seed dropdowns from data if empty
    refreshDropdownsFromData();
    saveDropdowns();
    toast(`Loaded ${STATE.records.length} records from data.csv`, 'ok');
  } catch(e) {
    // No data.csv — that's fine, will start empty
    console.log('No data.csv found, starting empty');
  }
}

function refreshDropdownsFromData() {
  const fields = {
    Customer: 'customer', CreatedBy: 'created_by', ResolvedBy: 'resolved_by',
    SubCategory: 'sub_category', RequestType: 'request_type'
  };
  for (const [dKey, fKey] of Object.entries(fields)) {
    const vals = [...new Set(STATE.records.map(r => r[fKey]).filter(v => v))].sort();
    if (vals.length > 0) STATE.dropdowns[dKey] = vals;
  }
}

// ====== VIEWER GATE ======
function showViewerGate() {
  $('#viewer-gate').classList.remove('hidden');
  $('#app').classList.add('hidden');
  const pwd = $('#viewer-pwd');
  const err = $('#viewer-err');
  pwd.value = '';
  pwd.focus();
  err.textContent = '';

  const submit = () => {
    if (pwd.value === PWD_VIEWER || pwd.value === PWD_ADMIN) {
      if (pwd.value === PWD_ADMIN) STATE.isAdmin = true;
      sessionStorage.setItem('techhub_viewer_ok', '1');
      $('#viewer-gate').classList.add('hidden');
      $('#app').classList.remove('hidden');
      navigate();
    } else {
      err.textContent = 'Incorrect password.';
      pwd.value = '';
      pwd.focus();
    }
  };
  $('#viewer-submit').onclick = submit;
  pwd.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ====== BOOT ======
async function boot() {
  loadStorage();

  // Check viewer gate
  if (sessionStorage.getItem('techhub_viewer_ok') === '1') {
    $('#viewer-gate').classList.add('hidden');
    $('#app').classList.remove('hidden');
  } else {
    showViewerGate();
  }

  await trySeedFromCSV();
  window.addEventListener('hashchange', navigate);
  navigate();
}

boot();

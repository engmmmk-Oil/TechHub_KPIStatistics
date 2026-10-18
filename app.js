/* ===========================================================================
   Tech Hub — Operations Dashboard
   - Single-page app, hash routing
   - Two-tier password gate (viewer + admin)
   - localStorage data persistence + CSV import/export
   - Dropdowns editable via Settings
   - All KPIs, charts, filters
=========================================================================== */

const PWD_VIEWER = 'MMK';
const PWD_ADMIN  = 'MMK_3';
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

// Country → Region defaults (approved mapping, 23 countries + Indonesia unmapped on purpose)
const COUNTRY_TO_REGION = {
  'Saudi Arabia': 'Middle East', 'Oman': 'Middle East', 'UAE': 'Middle East',
  'Qatar': 'Middle East', 'Bahrain': 'Middle East', 'Iraq': 'Middle East',
  'Kuwait': 'Kuwait',
  'Egypt': 'Africa', 'Chad': 'Africa', 'Congo': 'Africa', 'South Sudan': 'Africa',
  'Sudan': 'Africa', 'Nigeria': 'Africa', 'Angola': 'Africa', 'Gabon': 'Africa',
  'Libya': 'Africa', 'Algeria': 'Africa',
  'Colombia': 'Latin America', 'Ecuador': 'Latin America', 'Mexico': 'Latin America',
  'Brazil': 'Latin America', 'Argentina': 'Latin America', 'Venezuela': 'Latin America',
  'Peru': 'Latin America'
};

// 5 Segments (confirmed with user)
const SEGMENTS = [
  'Application Engineering',
  'Field Operations',
  'Surface Equipment',
  'Manufacturing',
  'Engineering'
];

// Category → Segment mapping (confirmed with user)
const CATEGORY_TO_SEGMENT = {
  'Application Engineering': 'Application Engineering',
  'Operations & Troubleshooting': 'Field Operations',
  'Field Service / Rig related': 'Field Operations',
  'Completions and other Accessories': 'Field Operations',
  'Surface Equipment - APC': 'Surface Equipment',
  'Surface Equipment - Non APC': 'Surface Equipment',
  'Manufacturing, Assembly, Repair and Test': 'Manufacturing',
  'Teardown & Analysis': 'Engineering',
  'R&D Downhole Equipment': 'Engineering',
  'Test Category': ''
};

// Segment → Categories (inverse index for cascade dropdown)
const SEGMENT_TO_CATEGORIES = {};
for (const [cat, seg] of Object.entries(CATEGORY_TO_SEGMENT)) {
  if (!seg) continue;
  if (!SEGMENT_TO_CATEGORIES[seg]) SEGMENT_TO_CATEGORIES[seg] = [];
  SEGMENT_TO_CATEGORIES[seg].push(cat);
}

// Category → Sub-Category cascade map (from APC Active Sub-Category master list)
const CATEGORY_TO_SUBCATEGORY = {
  'Application Engineering': [
    'APC Equipment Portfolio',
    'APC Equipment Specification',
    'Advanced ESP Design',
    'DIFA',
    'Operational Performance Optimization',
    'Standard ESP Design',
    'Technical Design Solutions',
    'Third-Party Technical Solutions'
  ],
  'Field Service / Rig related': [
    '3rd party products and services',
    'Commissioning',
    'Equipment Handling',
    'FS Tools Drawing',
    'FS reporting',
    'Installation',
    'Location layout and setup',
    'Pulling',
    'Start-up & Commissioning',
    'Tooling and consumables',
    'Troubleshooting'
  ],
  'Manufacturing, Assembly, Repair and Test': [
    'ESP Disassembly Tool',
    'Inspection / Quality',
    'Inspection Services',
    'Machining',
    'Repair',
    'Test',
    'Tooling and equipment',
    'Warehousing'
  ],
  'Operations & Troubleshooting': [
    'Diagnostic Guidance / Case Matching',
    'Failure declarations',
    'Production Optimization & Performance Analysis'
  ],
  'R&D Downhole Equipment': [
    'Existing product',
    'GasSep/intake',
    'MLE-Power Connector',
    'Manufacturing/quality',
    'Motor',
    'Product Development',
    'Protector',
    'Pump',
    'Sustaining'
  ],
  'Surface Equipment - APC': [
    'Hardware related',
    'SE Maintenance',
    'SE Troubleshooting',
    'Software related'
  ],
  'Teardown & Analysis': [
    'Dismantle process',
    'Final DIFA report',
    'Primary Failure Report /PFR',
    'RCFA'
  ],
  'Test Category': [
    'Test Sub-Category'
  ]
};

// Priority → Request Type cascade map (from GOS Priority Matrix)
const PRIORITY_TO_REQUEST_TYPE = {
  'Critical (6 Hours)': [
    'Operational job in progress (Rig Up / Running)',
    'High production deferment (NPT / ID related)',
    'Risk of losing well or equipment',
    'Well control / safety risk'
  ],
  'High (1 Working day)': [
    'Production reduced or stopped (No NPT / ID related)',
    'Field troubleshooting needed (not rig-dependent)',
    'High-value customer deliverable with deadline',
    'Technical clarification blocking confirmed opportunity'
  ],
  'Medium (3 Working days)': [
    'Engineering clarifications',
    'Design support not tied to active rig jobs',
    'Optimization analysis'
  ],
  'Low (5 Working days)': [
    'Upcoming tender / project',
    'Post-job documentation',
    'Process improvement',
    'RCFA report',
    'Training / documentation requests'
  ]
};

// Default dropdowns
const DEFAULT_DROPDOWNS = {
  Region:        ['Kuwait','Middle East','Latin America','Africa'],
  Country:       Object.keys(COUNTRY_TO_REGION),
  Priority:      Object.keys(DEFAULT_SLA),
  Category:      Object.keys(CATEGORY_TO_SUBCATEGORY),
  SubCategory:   [].concat(...Object.values(CATEGORY_TO_SUBCATEGORY)).sort(),
  StatusReason:  ['Resolved','Resolved (Automatically)'],
  ResponseDone:  ['Yes','No','Answered before','Need more information'],
  SLAStatus:     ['Succeeded','Noncompliant','Canceled','In Progress'],
  Customer:      [],
  CreatedBy:     [],
  ResolvedBy:    [],
  RequestType:   [].concat(...Object.values(PRIORITY_TO_REQUEST_TYPE)),
  ImpactFlag:    ['Yes','No','N/A']
};

// ====== STATE ======
let STATE = {
  records: [],
  dropdowns: {},
  filters: { year: 'all', month: 'all', region: 'all', country: 'all', priority: 'all' },
  isAdmin: false,
  currentPage: 'dashboard',
  charts: {},
  chartLabels: {}   // { chartId: true/false } — per-chart data-label toggle
};

// ====== UTILITIES ======
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Panel head with a data-label toggle icon on the right
function panelHead(title, chartId, note = '') {
  const on = STATE.chartLabels[chartId] ? 'on' : '';
  const noteHtml = note ? `<span class="panel-note" style="margin-right:8px;">${note}</span>` : '';
  return `<div class="panel-head">
    <div class="panel-title">${title}</div>
    <div style="display:flex;align-items:center;gap:4px;">
      ${noteHtml}
      <button class="chart-label-toggle ${on}" data-chart-id="${chartId}" title="Toggle data labels" aria-label="Toggle data labels">#</button>
    </div>
  </div>`;
}

// Global Chart.js plugin: draws inline data labels when enabled per-chart
const dataLabelsPlugin = {
  id: 'inlineDataLabels',
  afterDatasetsDraw(chart, args, opts) {
    if (!opts || !opts.enabled) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#1F2937';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const chartType = chart.config.type;
    chart.data.datasets.forEach((dataset, di) => {
      // Skip line datasets in mixed charts (labels get crowded)
      if (dataset.type === 'line') return;
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((element, i) => {
        const raw = dataset.data[i];
        if (raw == null || raw === '') return;
        let label;
        if (typeof raw === 'number') {
          label = Number.isInteger(raw) ? String(raw) : raw.toFixed(1);
          // If it's a percentage-style dataset (max <= 100 and formatted %)
          if (dataset.label && /%/.test(dataset.label)) label = raw.toFixed(0) + '%';
        } else {
          label = String(raw);
        }

        const pos = element.tooltipPosition ? element.tooltipPosition() : { x: element.x, y: element.y };
        let tx = pos.x, ty = pos.y;

        // For bars: place above (positive) or below (negative)
        if (chartType === 'bar' || (dataset.type === 'bar')) {
          if (chart.options.indexAxis === 'y') {
            tx = element.x + 14;  // to right of horizontal bar
            ty = element.y;
            ctx.textAlign = 'left';
          } else {
            const isNeg = typeof raw === 'number' && raw < 0;
            ty = element.y + (isNeg ? 12 : -8);
            ctx.textAlign = 'center';
          }
        } else if (chartType === 'pie' || chartType === 'doughnut') {
          // Centroid of the arc
          const model = element.getCenterPoint ? element.getCenterPoint() : element.tooltipPosition();
          tx = model.x;
          ty = model.y;
          ctx.fillStyle = '#FFFFFF';
        }

        ctx.fillText(label, tx, ty);
        ctx.fillStyle = '#1F2937';
        ctx.textAlign = 'center';
      });
    });
    ctx.restore();
  }
};
if (typeof Chart !== 'undefined') Chart.register(dataLabelsPlugin);

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

  try {
    const cl = localStorage.getItem('techhub_chart_labels');
    if (cl) STATE.chartLabels = JSON.parse(cl);
  } catch(e) { STATE.chartLabels = {}; }
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
    if (f.month !== 'all' && r._created && String(r._created.getMonth() + 1) !== String(f.month)) return false;
    if (f.region !== 'all' && r.region !== f.region) return false;
    if (f.country !== 'all' && r.country !== f.country) return false;
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
  const showFilters = ['dashboard','yoy','sla','mttr','volume','workload'].includes(page);
  $('#topbar-filters').style.display = showFilters ? 'flex' : 'none';
  // On YoY page, hide the Year filter — the page has its own current/prior year selectors
  const yearGroup = $('#filter-group-year');
  if (yearGroup) yearGroup.style.display = (page === 'yoy') ? 'none' : 'flex';

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

  // Attach click handler for chart data-label toggle buttons
  $$('.chart-label-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.chartId;
      STATE.chartLabels[cid] = !STATE.chartLabels[cid];
      try { localStorage.setItem('techhub_chart_labels', JSON.stringify(STATE.chartLabels)); } catch(e){}
      renderPage(STATE.currentPage);
    });
  });
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
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function buildFilterBar() {
  const all = enrichedAll().filter(r => r._includeKPI);
  const years = [...new Set(all.map(r => r._year).filter(y => y))].sort();
  const regions = [...new Set(all.map(r => r.region).filter(Boolean))].sort();
  const countries = [...new Set(all.map(r => r.country).filter(Boolean))].sort();
  const priorities = [...new Set(all.map(r => r.priority).filter(Boolean))].sort();

  const fillSel = (sel, items, cur) => {
    if (!sel) return;
    sel.innerHTML = `<option value="all">All</option>` + items.map(i => `<option value="${escapeHtml(i)}" ${cur===String(i)?'selected':''}>${escapeHtml(i)}</option>`).join('');
  };

  // Months: fixed 1-12 with labels
  const monthSel = $('#filter-month');
  if (monthSel) {
    monthSel.innerHTML = `<option value="all">All</option>` + MONTH_LABELS.map((label, i) => {
      const val = i + 1;
      return `<option value="${val}" ${String(STATE.filters.month) === String(val) ? 'selected' : ''}>${label}</option>`;
    }).join('');
  }

  fillSel($('#filter-year'), years, STATE.filters.year);
  fillSel($('#filter-region'), regions, STATE.filters.region);
  fillSel($('#filter-country'), countries, STATE.filters.country);
  fillSel($('#filter-priority'), priorities, STATE.filters.priority);

  // Set current filters (redundant safety after fillSel)
  if ($('#filter-year'))     $('#filter-year').value     = STATE.filters.year;
  if ($('#filter-month'))    $('#filter-month').value    = STATE.filters.month;
  if ($('#filter-region'))   $('#filter-region').value   = STATE.filters.region;
  if ($('#filter-country'))  $('#filter-country').value  = STATE.filters.country;
  if ($('#filter-priority')) $('#filter-priority').value = STATE.filters.priority;
}

function setupFilterListeners() {
  const bind = (id, key) => {
    const el = $(id);
    if (!el) return;
    // Avoid double-binding: replace by cloning
    const fresh = el.cloneNode(true);
    el.parentNode.replaceChild(fresh, el);
    fresh.value = STATE.filters[key];
    fresh.addEventListener('change', e => { STATE.filters[key] = e.target.value; renderPage(STATE.currentPage); });
  };
  bind('#filter-year', 'year');
  bind('#filter-month', 'month');
  bind('#filter-region', 'region');
  bind('#filter-country', 'country');
  bind('#filter-priority', 'priority');

  const rst = $('#filter-reset');
  if (rst) {
    const fresh = rst.cloneNode(true);
    rst.parentNode.replaceChild(fresh, rst);
    fresh.addEventListener('click', () => {
      STATE.filters = { year: 'all', month: 'all', region: 'all', country: 'all', priority: 'all' };
      buildFilterBar();
      renderPage(STATE.currentPage);
    });
  }
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
      <div class="section-head" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <div class="section-title">${STATE.filters.year === 'all' ? 'Overall performance' : `Year ${STATE.filters.year}`}</div>
          <div class="section-note">${filtered.length} records · ${STATE.filters.region === 'all' ? 'All regions' : STATE.filters.region} · ${STATE.filters.priority === 'all' ? 'All priorities' : STATE.filters.priority}</div>
        </div>
        ${STATE.isAdmin ? `
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn-primary" id="btn-download-report" title="Generate Word report for a chosen month or YTD">
            📄 Download Monthly Report
          </button>
        </div>` : ''}
      </div>

      <div class="kpi-grid">
        ${kpiCardHTML('Total requests', fmtNum(k.total), '', '')}
        ${kpiCardHTML('SLA compliance', k.slaCompliance == null ? '—' : fmtPct(k.slaCompliance), '', complianceTone(k.slaCompliance))}
        ${kpiCardHTML('Avg response TAT', k.avgTat == null ? '—' : k.avgTat.toFixed(1), 'hrs', '')}
        ${kpiCardHTML('SLA breaches', fmtNum(k.breach), '', k.breach > 0 ? 'bad' : 'good')}
        ${kpiCardHTML('Response vs target', k.avgVsTarget == null ? '—' : fmtSigned(-k.avgVsTarget,1), 'hrs', k.avgVsTarget <= 0 ? 'good' : 'bad')}
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
          ${panelHead('SLA compliance by priority', 'ch-priority')}
          <div class="chart-box"><canvas id="ch-priority"></canvas></div>
        </div>
        <div class="panel">
          ${panelHead('SLA compliance by region', 'ch-region')}
          <div class="chart-box"><canvas id="ch-region"></canvas></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Volume distribution (%)</div>
        <div class="section-note">Same data as above, shown as percentage share of total tickets</div>
      </div>
      <div class="grid-2">
        <div class="panel">
          ${panelHead('SLA volume by priority (%)', 'ch-priority-pie')}
          <div class="chart-box"><canvas id="ch-priority-pie"></canvas></div>
        </div>
        <div class="panel">
          ${panelHead('SLA volume by region (%)', 'ch-region-pie')}
          <div class="chart-box"><canvas id="ch-region-pie"></canvas></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Lifetime distribution — Category &amp; Sub-Category</div>
        <div class="section-note">All records in CSV (ignores top-bar filters) — shows full historical mix</div>
      </div>
      <div class="grid-2">
        <div class="panel">
          ${panelHead('By Category (lifetime)', 'ch-cat-lifetime')}
          <div class="chart-box"><canvas id="ch-cat-lifetime"></canvas></div>
        </div>
        <div class="panel">
          ${panelHead('By Sub-Category (lifetime, Top 10 + Other)', 'ch-subcat-lifetime')}
          <div class="chart-box"><canvas id="ch-subcat-lifetime"></canvas></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Volume trend</div>
      </div>
      <div class="panel">
        ${panelHead('Monthly volume &amp; compliance %', 'ch-trend')}
        <div class="chart-box lg"><canvas id="ch-trend"></canvas></div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Customers · Submitters · Responders</div>
      </div>
      <div class="grid-3">
        <div class="panel">
          ${panelHead('Top 5 customers by volume', 'ch-customers')}
          <div class="chart-box"><canvas id="ch-customers"></canvas></div>
        </div>
        <div class="panel">
          ${panelHead('Top 5 submitters by volume', 'ch-submitters', 'Who is filing tickets')}
          <div class="chart-box"><canvas id="ch-submitters"></canvas></div>
        </div>
        <div class="panel">
          ${panelHead('Top 5 responders', 'ch-owners', 'Volume + SLA compliance')}
          <div class="chart-box"><canvas id="ch-owners"></canvas></div>
        </div>
      </div>
    </div>
  `;
  $('#page').innerHTML = html;

  // ---- Build charts ----
  buildPriorityChart(filtered);
  buildRegionChart(filtered);
  buildPriorityPieDash(filtered);
  buildRegionPieDash(filtered);
  // Lifetime pies — ALWAYS use the full, unfiltered record set
  buildCategoryPieLifetime();
  buildSubCategoryPieLifetime();
  buildTrendChart(filtered);
  buildTopCustomersChart(filtered);
  buildTopSubmittersChart(filtered);
  buildTopOwnersChart(filtered);

  setupFilterListeners();

  // Wire up Download Monthly Report button (Admin only)
  const dlBtn = document.getElementById('btn-download-report');
  if (dlBtn) dlBtn.addEventListener('click', openReportDialog);
}

function complianceTone(v) {
  if (v == null) return '';
  if (v >= 0.85) return 'good';
  if (v >= 0.65) return 'warn';
  return 'bad';
}

// ====== CHARTS ======
const C = {
  ink:   '#4A4950',   // APC DARK_GRAY (was deep navy)
  steel: '#3D6B91',
  burnt: '#D8C297',   // APC GOLD (was burnt orange)
  sage:  '#5A8F6B',
  brick: '#B04545',
  amber: '#C49434',
  line:  '#E5E2DA',
  text3: '#6B7280'
};

// Returns { inlineDataLabels: { enabled: true } } if labels toggled on for this chart
function labelPluginFor(chartId) {
  return { inlineDataLabels: { enabled: !!STATE.chartLabels[chartId] } };
}

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
    options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, ...labelPluginFor('ch-priority') }, scales: { ...chartDefaults().scales, x: { ...chartDefaults().scales.x, stacked: true }, y: { ...chartDefaults().scales.y, stacked: true } } }
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
    options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, ...labelPluginFor('ch-region') } }
  });
}

// Pie chart: SLA volume by priority (percentage share)
function buildPriorityPieDash(records) {
  const priOrder = ['Critical (6 Hours)', 'High (1 Working day)', 'Medium (3 Working days)', 'Low (5 Working days)'];
  const counts = {};
  records.forEach(r => { const v = r.priority || '—'; counts[v] = (counts[v] || 0) + 1; });
  const labels = priOrder.filter(p => counts[p]).concat(Object.keys(counts).filter(k => !priOrder.includes(k)));
  const values = labels.map(l => counts[l]);
  const colors = [C.brick, C.amber, C.steel, C.sage, '#7A7982'];
  if (!labels.length) return;
  const total = values.reduce((a,b) => a+b, 0);
  const ctx = $('#ch-priority-pie').getContext('2d');
  STATE.charts.priorityPie = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels.map((l,i) => `${l.split(' ')[0]} (${((values[i]/total)*100).toFixed(1)}%)`),
      datasets: [{ data: values, backgroundColor: colors, borderColor: '#FFFFFF', borderWidth: 1.5 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { family: 'Arial', size: 11 }, color: C.text3, boxWidth: 10, boxHeight: 10, padding: 8 } },
        tooltip: {
          backgroundColor: C.ink,
          titleFont: { family: 'Arial', size: 12, weight: '600' },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          padding: 10,
          callbacks: {
            label: (c) => `${labels[c.dataIndex]}: ${c.parsed} tickets (${((c.parsed/total)*100).toFixed(1)}%)`
          }
        },
        ...labelPluginFor('ch-priority-pie')
      }
    }
  });
}

// Pie chart: SLA volume by region (percentage share)
function buildRegionPieDash(records) {
  const counts = {};
  records.forEach(r => { const v = r.region || '—'; counts[v] = (counts[v] || 0) + 1; });
  const entries = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  if (!entries.length) return;
  const total = entries.reduce((a, [_,c]) => a+c, 0);
  const colors = [C.steel, C.burnt, C.sage, C.amber, C.brick, '#7A7982'];
  const ctx = $('#ch-region-pie').getContext('2d');
  STATE.charts.regionPie = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: entries.map(([n,c]) => `${n} (${((c/total)*100).toFixed(1)}%)`),
      datasets: [{ data: entries.map(([_,c]) => c), backgroundColor: colors, borderColor: '#FFFFFF', borderWidth: 1.5 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { family: 'Arial', size: 11 }, color: C.text3, boxWidth: 10, boxHeight: 10, padding: 8 } },
        tooltip: {
          backgroundColor: C.ink,
          titleFont: { family: 'Arial', size: 12, weight: '600' },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          padding: 10,
          callbacks: {
            label: (c) => `${entries[c.dataIndex][0]}: ${c.parsed} tickets (${((c.parsed/total)*100).toFixed(1)}%)`
          }
        },
        ...labelPluginFor('ch-region-pie')
      }
    }
  });
}

// ---- LIFETIME pies (always full dataset, ignore filters) ----
// Shared pie palette (10 slices, cycles if more)
const LIFETIME_PIE_PALETTE = [
  '#4A4950', '#D8C297', '#5A8F6B', '#3D6B91', '#B04545',
  '#C49434', '#B89E70', '#948984', '#CCC3BB', '#7A8B9C'
];

function buildCategoryPieLifetime() {
  // ALWAYS use the full record set (ignores filters)
  const records = enrichedAll().filter(r => r._includeKPI);
  const counts = {};
  records.forEach(r => {
    const v = (r.category || '').trim() || 'Unspecified';
    counts[v] = (counts[v] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;
  const total = entries.reduce((s, [_, c]) => s + c, 0);
  const ctx = $('#ch-cat-lifetime').getContext('2d');
  STATE.charts.catLifetime = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: entries.map(([n, c]) => `${n.length > 32 ? n.slice(0, 30) + '…' : n} (${((c / total) * 100).toFixed(1)}%)`),
      datasets: [{
        data: entries.map(([_, c]) => c),
        backgroundColor: entries.map((_, i) => LIFETIME_PIE_PALETTE[i % LIFETIME_PIE_PALETTE.length]),
        borderColor: '#FFFFFF',
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { font: { family: 'Arial', size: 10 }, color: C.text3, boxWidth: 10, boxHeight: 10, padding: 6 }
        },
        tooltip: {
          backgroundColor: C.ink,
          titleFont: { family: 'Arial', size: 12, weight: '600' },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          padding: 10,
          callbacks: {
            label: (c) => `${entries[c.dataIndex][0]}: ${c.parsed} tickets (${((c.parsed / total) * 100).toFixed(1)}%)`
          }
        },
        ...labelPluginFor('ch-cat-lifetime')
      }
    }
  });
}

function buildSubCategoryPieLifetime() {
  const records = enrichedAll().filter(r => r._includeKPI);
  const counts = {};
  records.forEach(r => {
    const v = (r.sub_category || '').trim() || 'Unspecified';
    counts[v] = (counts[v] || 0) + 1;
  });
  const all = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!all.length) return;
  // Top 10 + "Other" bucket for readability
  const top = all.slice(0, 10);
  const other = all.slice(10).reduce((s, [_, c]) => s + c, 0);
  const entries = other > 0 ? [...top, ['Other', other]] : top;
  const total = entries.reduce((s, [_, c]) => s + c, 0);
  const ctx = $('#ch-subcat-lifetime').getContext('2d');
  STATE.charts.subcatLifetime = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: entries.map(([n, c]) => `${n.length > 28 ? n.slice(0, 26) + '…' : n} (${((c / total) * 100).toFixed(1)}%)`),
      datasets: [{
        data: entries.map(([_, c]) => c),
        backgroundColor: entries.map((_, i) => LIFETIME_PIE_PALETTE[i % LIFETIME_PIE_PALETTE.length]),
        borderColor: '#FFFFFF',
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { font: { family: 'Arial', size: 10 }, color: C.text3, boxWidth: 10, boxHeight: 10, padding: 6 }
        },
        tooltip: {
          backgroundColor: C.ink,
          titleFont: { family: 'Arial', size: 12, weight: '600' },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          padding: 10,
          callbacks: {
            label: (c) => `${entries[c.dataIndex][0]}: ${c.parsed} tickets (${((c.parsed / total) * 100).toFixed(1)}%)`
          }
        },
        ...labelPluginFor('ch-subcat-lifetime')
      }
    }
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
      plugins: { ...opt.plugins, ...labelPluginFor('ch-trend') },
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
      labels: top.map(t => t[0].length > 22 ? t[0].slice(0,22)+'…' : t[0]),
      datasets: [{ data: top.map(t => t[1]), backgroundColor: C.steel, borderRadius: 4 }]
    },
    options: { ...chartDefaults(), indexAxis: 'y', plugins: { ...chartDefaults().plugins, legend: { display: false }, ...labelPluginFor('ch-customers') } }
  });
}

function buildTopSubmittersChart(records) {
  const counts = {};
  records.forEach(r => {
    const s = r.created_by || '—';
    counts[s] = (counts[s]||0) + 1;
  });
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,5);
  const ctx = $('#ch-submitters').getContext('2d');
  STATE.charts.submitters = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(t => t[0].length > 22 ? t[0].slice(0,22)+'…' : t[0]),
      datasets: [{ data: top.map(t => t[1]), backgroundColor: C.sage, borderRadius: 4 }]
    },
    options: { ...chartDefaults(), indexAxis: 'y', plugins: { ...chartDefaults().plugins, legend: { display: false }, ...labelPluginFor('ch-submitters') } }
  });
}

function buildTopOwnersChart(records) {
  // Per-owner: volume + SLA compliance %
  const stats = {};
  records.forEach(r => {
    const o = r.resolved_by || '—';
    if (!stats[o]) stats[o] = { total: 0, compliant: 0, breached: 0 };
    stats[o].total++;
    if (r._slaCompliant === 'Compliant') stats[o].compliant++;
    if (r._slaCompliant === 'Breached')  stats[o].breached++;
  });
  const arr = Object.entries(stats).map(([name, s]) => ({
    name,
    total: s.total,
    compRate: (s.compliant + s.breached) > 0 ? (s.compliant / (s.compliant + s.breached)) * 100 : null
  })).sort((a,b) => b.total - a.total).slice(0, 5);

  const ctx = $('#ch-owners').getContext('2d');
  STATE.charts.owners = new Chart(ctx, {
    data: {
      labels: arr.map(t => t.name.length > 20 ? t.name.slice(0,20)+'…' : t.name),
      datasets: [
        { type: 'bar', label: 'Volume', data: arr.map(t => t.total), backgroundColor: C.burnt, borderRadius: 4, xAxisID: 'x', order: 2 },
        { type: 'line', label: 'Compliance %', data: arr.map(t => t.compRate), borderColor: C.ink, backgroundColor: C.ink, xAxisID: 'x1', pointRadius: 4, pointBackgroundColor: C.ink, borderWidth: 0, showLine: false, order: 1 }
      ]
    },
    options: {
      ...chartDefaults(),
      indexAxis: 'y',
      plugins: {
        ...chartDefaults().plugins,
        legend: { display: true, position: 'bottom', labels: { font: { family: 'Inter', size: 10 }, color: C.text3, boxWidth: 8, boxHeight: 8, padding: 8 } },
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.label === 'Compliance %') return ctx.parsed.x == null ? 'No SLA data' : `Compliance: ${ctx.parsed.x.toFixed(1)}%`;
              return `Volume: ${ctx.parsed.x}`;
            }
          }
        },
        ...labelPluginFor('ch-owners')
      },
      scales: {
        x: { beginAtZero: true, position: 'bottom', grid: { color: C.line, drawBorder: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: C.text3 }, title: { display: true, text: 'Volume', font: { family:'Inter', size: 10 }, color: C.text3 } },
        x1: { beginAtZero: true, max: 100, position: 'top', grid: { drawOnChartArea: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: C.text3, callback: v => v + '%' }, title: { display: true, text: 'Compliance %', font: { family:'Inter', size: 10 }, color: C.text3 } },
        y: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 }, color: C.text3 } }
      }
    }
  });
}

// ====== YEAR-OVER-YEAR PAGE ======
function renderYoY() {
  buildFilterBar();
  // Apply all filters EXCEPT year (YoY has its own year selectors)
  const applyYoYFilters = (records) => {
    const f = STATE.filters;
    return records.filter(r => {
      if (!r._includeKPI) return false;
      if (f.month !== 'all' && r._created && String(r._created.getMonth() + 1) !== String(f.month)) return false;
      if (f.region !== 'all' && r.region !== f.region) return false;
      if (f.country !== 'all' && r.country !== f.country) return false;
      if (f.priority !== 'all' && r.priority !== f.priority) return false;
      return true;
    });
  };
  const all = applyYoYFilters(enrichedAll());
  const years = [...new Set(all.map(r => r._year).filter(y => y))].sort();
  const currentYear = years.length ? Math.max(...years) : new Date().getFullYear();
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
            ${kpiCardHTML(`${cur} avg vs target`, cK.avgVsTarget == null ? '—' : fmtSigned(-cK.avgVsTarget,1), 'hrs', cK.avgVsTarget <= 0 ? 'good' : 'bad')}
            ${kpiCardHTML(`${pr} avg vs target`, pK.avgVsTarget == null ? '—' : fmtSigned(-pK.avgVsTarget,1), 'hrs', pK.avgVsTarget <= 0 ? 'good' : 'bad')}
            ${kpiCardHTML('Δ change', dVsTarget == null ? '—' : fmtSigned(-dVsTarget,1) + ' hrs', '', dVsTarget < 0 ? 'good' : (dVsTarget > 0 ? 'bad' : ''))}
          </div>
          <div class="text-mute text-small mt-8">Positive = ahead of target · Negative = delayed vs target</div>
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
            ${panelHead('Total requests by year', 'ch-yoy-volume')}
            <div class="chart-box"><canvas id="ch-yoy-volume"></canvas></div>
          </div>
          <div class="panel">
            ${panelHead('SLA compliance % by year', 'ch-yoy-compliance')}
            <div class="chart-box"><canvas id="ch-yoy-compliance"></canvas></div>
          </div>
          <div class="panel">
            ${panelHead('Avg response TAT (hrs) by year', 'ch-yoy-tat')}
            <div class="chart-box"><canvas id="ch-yoy-tat"></canvas></div>
          </div>
          <div class="panel">
            ${panelHead('SLA breaches by year', 'ch-yoy-breaches')}
            <div class="chart-box"><canvas id="ch-yoy-breaches"></canvas></div>
          </div>
          <div class="panel" style="grid-column: span 2;">
            ${panelHead('Response vs target (hrs) by year', 'ch-yoy-vstarget', 'Positive bars = ahead of target · negative bars = delayed vs target')}
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
  setupFilterListeners();
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
            <td class="num">${r.k.avgVsTarget == null ? '—' : fmtSigned(-r.k.avgVsTarget,1)}</td>
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

  // Common options for the small charts — accepts chartId to enable per-chart label toggle
  const smallChartOpts = (titleText, valueFormat, suggestedMin, chartId) => ({
    ...opt,
    plugins: {
      ...opt.plugins,
      legend: { display: false },
      tooltip: {
        ...opt.plugins.tooltip,
        callbacks: {
          label: (ctx) => valueFormat ? valueFormat(ctx.parsed.y) : String(ctx.parsed.y)
        }
      },
      ...(chartId ? labelPluginFor(chartId) : {})
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
    options: smallChartOpts('Requests', (v) => `${v} requests`, undefined, 'ch-yoy-volume')
  });

  // 2) Compliance % by year
  STATE.charts.yoyCompliance = new Chart($('#ch-yoy-compliance').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Compliance %', data: rows.map(r => r.compliance), backgroundColor: barColors, borderRadius: 4 }]
    },
    options: {
      ...smallChartOpts('Compliance %', (v) => `${v == null ? '—' : v.toFixed(1)}%`, undefined, 'ch-yoy-compliance'),
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
    options: smallChartOpts('Avg TAT (hrs)', (v) => `${v == null ? '—' : v.toFixed(1)} hrs`, undefined, 'ch-yoy-tat')
  });

  // 4) SLA Breaches by year
  STATE.charts.yoyBreaches = new Chart($('#ch-yoy-breaches').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Breaches', data: rows.map(r => r.breaches), backgroundColor: rows.map(r => r.y === cur || r.y === pr ? colorFor(r.y) : C.brick), borderRadius: 4 }]
    },
    options: smallChartOpts('Breaches', (v) => `${v} breaches`, undefined, 'ch-yoy-breaches')
  });

  // 5) Response vs Target by year — DISPLAY sign flipped: positive = ahead of target (good), negative = delayed (bad)
  // Color logic still uses INTERNAL value for correct meaning (internal <= 0 = good, so sage)
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
      datasets: [{ label: 'Response vs target (hrs)', data: rows.map(r => r.vsTarget == null ? null : -r.vsTarget), backgroundColor: vsTargetColors, borderRadius: 4 }]
    },
    options: {
      ...smallChartOpts('Response vs target (hrs)', (v) => `${v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1)} hrs`, undefined, 'ch-yoy-vstarget'),
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
      <div class="panel">
        ${panelHead('Monthly ticket volume', 'ch-monthly')}
        <div class="chart-box lg"><canvas id="ch-monthly"></canvas></div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-title">Distribution — Category &amp; Sub-Category</div>
        <div class="section-note">Filtered by the top bar (year, region, priority)</div>
      </div>
      <div class="grid-2">
        <div class="panel">
          ${panelHead('By Category', 'ch-cat')}
          <div class="chart-box lg"><canvas id="ch-cat"></canvas></div>
        </div>
        <div class="panel">
          ${panelHead('By Sub-Category (Top 10 + Other)', 'ch-subcat')}
          <div class="chart-box lg"><canvas id="ch-subcat"></canvas></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><div class="section-title">Distribution — Priority &amp; Region</div></div>
      <div class="grid-2">
        <div class="panel">
          ${panelHead('By Priority', 'ch-pri-mix')}
          <div class="chart-box"><canvas id="ch-pri-mix"></canvas></div>
        </div>
        <div class="panel">
          ${panelHead('By Region', 'ch-reg-mix')}
          <div class="chart-box"><canvas id="ch-reg-mix"></canvas></div>
        </div>
      </div>
    </div>
  `;

  buildMonthlyVolumeChart(records);
  buildCategoryPie(records);
  buildSubCategoryPie(records);
  buildPriorityPie(records);
  buildRegionPie(records);
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
      plugins: { ...chartDefaults().plugins, ...labelPluginFor('ch-monthly') },
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

function donutDataTopN(records, field, n) {
  const all = donutData(records, field);
  if (all.length <= n) return all;
  const top = all.slice(0, n);
  const other = all.slice(n).reduce((s, [_,c]) => s + c, 0);
  return [...top, ['Other', other]];
}

// Broad palette for pies with many slices — cycled if more slices than colors
const PIE_PALETTE = [
  '#3D6B91', '#D8C297', '#5A8F6B', '#C49434', '#B04545',
  '#4A4950', '#8CA6BF', '#E5D4A8', '#8AB596', '#DDC084',
  '#C8837E', '#7A7982', '#B0C4D8'
];

function pieOptions(chartId, legendPos = 'right') {
  const base = chartDefaults();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: legendPos,
        labels: { font: { family: 'Arial', size: 11 }, color: C.text3, boxWidth: 10, boxHeight: 10, padding: 8 }
      },
      tooltip: {
        backgroundColor: C.ink,
        titleFont: { family: 'Arial', size: 12, weight: '600' },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        padding: 10,
        cornerRadius: 6,
        boxPadding: 4,
        callbacks: {
          label: (ctx) => {
            const total = ctx.dataset.data.reduce((s,v)=>s+v,0);
            const pct = total ? (ctx.parsed / total * 100).toFixed(1) : 0;
            return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
          }
        }
      },
      ...labelPluginFor(chartId)
    }
  };
}

function buildCategoryPie(records) {
  const data = donutData(records, 'category');
  if (!data.length) return;
  const ctx = $('#ch-cat').getContext('2d');
  STATE.charts.cat = new Chart(ctx, {
    type: 'pie',
    data: { labels: data.map(d => d[0]), datasets: [{ data: data.map(d => d[1]), backgroundColor: PIE_PALETTE, borderColor: '#FFFFFF', borderWidth: 1.5 }] },
    options: pieOptions('ch-cat', 'right')
  });
}

function buildSubCategoryPie(records) {
  const data = donutDataTopN(records, 'sub_category', 10);
  if (!data.length) return;
  const ctx = $('#ch-subcat').getContext('2d');
  STATE.charts.subcat = new Chart(ctx, {
    type: 'pie',
    data: { labels: data.map(d => d[0]), datasets: [{ data: data.map(d => d[1]), backgroundColor: PIE_PALETTE, borderColor: '#FFFFFF', borderWidth: 1.5 }] },
    options: pieOptions('ch-subcat', 'right')
  });
}

function buildPriorityPie(records) {
  // Order priorities Critical → High → Medium → Low for consistent colors
  const priOrder = ['Critical (6 Hours)', 'High (1 Working day)', 'Medium (3 Working days)', 'Low (5 Working days)'];
  const counts = {};
  records.forEach(r => {
    const v = r.priority || '—';
    counts[v] = (counts[v] || 0) + 1;
  });
  const labels = priOrder.filter(p => counts[p]).concat(Object.keys(counts).filter(k => !priOrder.includes(k)));
  const values = labels.map(l => counts[l]);
  const priColors = [C.brick, C.amber, C.steel, C.sage, '#7A7982'];  // Critical=red, High=amber, Med=steel, Low=sage
  if (!labels.length) return;
  const ctx = $('#ch-pri-mix').getContext('2d');
  STATE.charts.priMix = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: priColors, borderColor: '#FFFFFF', borderWidth: 1.5 }] },
    options: pieOptions('ch-pri-mix', 'right')
  });
}

function buildRegionPie(records) {
  const data = donutData(records, 'region');
  if (!data.length) return;
  const ctx = $('#ch-reg-mix').getContext('2d');
  STATE.charts.regMix = new Chart(ctx, {
    type: 'pie',
    data: { labels: data.map(d => d[0]), datasets: [{ data: data.map(d => d[1]), backgroundColor: PIE_PALETTE, borderColor: '#FFFFFF', borderWidth: 1.5 }] },
    options: pieOptions('ch-reg-mix', 'right')
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
        (r.ticket_summary || '').toLowerCase().includes(q) ||
        (r.response_summary || '').toLowerCase().includes(q) ||
        (r.customer || '').toLowerCase().includes(q) ||
        (r.resolved_by || '').toLowerCase().includes(q) ||
        (r.created_by || '').toLowerCase().includes(q) ||
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

          <div class="field field-full">
            <label>Ticket summary <span style="color:var(--text-4);font-weight:400;">(optional, ~100 chars)</span></label>
            <input type="text" id="f-summary" value="${escapeHtml(rec.ticket_summary || '')}" maxlength="120" placeholder="One-line summary of the request" ${ro}>
          </div>

          <div class="field">
            <label>Customer</label>
            <select id="f-customer" ${ro}>${opt(rec.customer, D.Customer || [])}</select>
          </div>
          <div class="field">
            <label>Segment</label>
            <select id="f-segment" ${ro}>${opt(rec.segment || (CATEGORY_TO_SEGMENT[rec.category]||''), SEGMENTS)}</select>
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
            <label>Request type</label>
            <select id="f-type" ${ro}>${opt(rec.request_type, D.RequestType || [])}</select>
          </div>
          <div class="field">
            <label>Priority</label>
            <select id="f-priority" ${ro}>${opt(rec.priority, D.Priority || [])}</select>
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
            <label>Created on (date &amp; time)</label>
            <input type="datetime-local" id="f-created" value="${toInputDateTime(rec.created_on)}" ${ro}>
          </div>
          <div class="field">
            <label>Response date (date &amp; time)</label>
            <input type="datetime-local" id="f-response" value="${toInputDateTime(rec.response_date)}" ${ro}>
          </div>
          <div class="field">
            <label>Acceptance date (date &amp; time)</label>
            <input type="datetime-local" id="f-acceptance" value="${toInputDateTime(rec.acceptance_date)}" ${ro}>
            <small style="font-size:10px;color:var(--text-3);font-style:italic;margin-top:2px;">Fill only when ticket is resolved/closed</small>
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

          <div class="field field-full">
            <label>Response summary <span style="color:var(--text-4);font-weight:400;">(optional, ~200 chars — fill when resolved)</span></label>
            <textarea id="f-respsummary" maxlength="240" placeholder="Brief summary of the resolution / answer provided" style="min-height:55px;" ${ro}>${escapeHtml(rec.response_summary || '')}</textarea>
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

  // Cascade helper: rebuild a child dropdown's options based on a parent value's mapping.
  // "Smart" mode: if no parent picked, show full master list. Otherwise show only mapped options.
  function applyCascade(childSelectId, parentValue, mappingTable, fullMasterList) {
    const childSel = $(childSelectId);
    if (!childSel) return;
    const currentVal = childSel.value;
    const allowed = parentValue && mappingTable[parentValue]
      ? mappingTable[parentValue]
      : (fullMasterList || []);
    // Keep current value visible as an extra option if it isn't in the new allowed list
    // (so editing old records doesn't lose data)
    const allowedSet = new Set(allowed);
    const extras = currentVal && !allowedSet.has(currentVal) ? [currentVal] : [];
    const sorted = [...allowed].sort();
    let html = `<option value="">—</option>`;
    sorted.forEach(o => {
      html += `<option value="${escapeHtml(o)}"${o === currentVal ? ' selected' : ''}>${escapeHtml(o)}</option>`;
    });
    extras.forEach(o => {
      html += `<option value="${escapeHtml(o)}" selected>${escapeHtml(o)} (legacy)</option>`;
    });
    childSel.innerHTML = html;
  }

  // Initialize cascades on form open (so existing records' sub-cat / request-type lists
  // are filtered immediately based on their current Category / Priority).
  // When no parent is selected, show a UNION of the master list and any legacy values in current data.
  const masterSubList = [].concat(...Object.values(CATEGORY_TO_SUBCATEGORY));
  const fullSubList = [...new Set([...masterSubList, ...(D.SubCategory || [])])];
  const masterTypeList = [].concat(...Object.values(PRIORITY_TO_REQUEST_TYPE));
  const fullTypeList = [...new Set([...masterTypeList, ...(D.RequestType || [])])];

  applyCascade('#f-subcategory', $('#f-category').value, CATEGORY_TO_SUBCATEGORY, fullSubList);
  applyCascade('#f-type',        $('#f-priority').value, PRIORITY_TO_REQUEST_TYPE, fullTypeList);

  // Segment → Category cascade  (NEW: Segment is parent of Category)
  const fullCatList = [...new Set([...(D.Category || []), ...Object.keys(CATEGORY_TO_SEGMENT).filter(c => CATEGORY_TO_SEGMENT[c])])];
  if ($('#f-segment')) {
    applyCascade('#f-category', $('#f-segment').value, SEGMENT_TO_CATEGORIES, fullCatList);
    $('#f-segment').addEventListener('change', e => {
      applyCascade('#f-category', e.target.value, SEGMENT_TO_CATEGORIES, fullCatList);
      // When segment changes, clear category selection to avoid mismatch; then cascade sub-cat
      $('#f-category').value = '';
      applyCascade('#f-subcategory', '', CATEGORY_TO_SUBCATEGORY, fullSubList);
    });
  }

  // Category → Sub-Category cascade + auto-fill Segment when category chosen directly
  $('#f-category').addEventListener('change', e => {
    applyCascade('#f-subcategory', e.target.value, CATEGORY_TO_SUBCATEGORY, fullSubList);
    // Auto-fill Segment from Category (keeps hierarchy consistent)
    if ($('#f-segment') && CATEGORY_TO_SEGMENT[e.target.value]) {
      $('#f-segment').value = CATEGORY_TO_SEGMENT[e.target.value];
    }
  });

  // Priority → Request Type cascade
  $('#f-priority').addEventListener('change', e => {
    applyCascade('#f-type', e.target.value, PRIORITY_TO_REQUEST_TYPE, fullTypeList);
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
    ticket_summary: $('#f-summary') ? $('#f-summary').value : '',
    priority: $('#f-priority').value,
    status_reason: $('#f-status').value,
    response_done: $('#f-respdone').value,
    segment: ($('#f-segment') ? $('#f-segment').value : '') || CATEGORY_TO_SEGMENT[$('#f-category').value] || '',
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
    response_summary: $('#f-respsummary') ? $('#f-respsummary').value : '',
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
    $('#reset-all').addEventListener('click', async () => {
      if (!confirm('Delete ALL records and dropdowns, then reload the latest data.csv from the server? This cannot be undone.')) return;
      if (!confirm('Are you absolutely sure?')) return;
      STATE.records = [];
      STATE.dropdowns = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
      saveRecords();
      saveDropdowns();
      // Immediately re-seed from the live data.csv on the server (cache-busted)
      await trySeedFromCSV();
      toast('All data reset and re-seeded from data.csv', 'ok');
      location.hash = '#/dashboard';
      // Force a hard re-render after re-seed
      setTimeout(() => renderPage('dashboard'), 100);
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
    ticket_summary: get('ticket_summary','Ticket Summary','Summary'),
    priority: get('priority','Priority'),
    status_reason: get('status_reason','Status Reason','Status'),
    response_done: get('response_done','Response Done'),
    segment: get('segment','Segment') || CATEGORY_TO_SEGMENT[get('category','Category')] || '',
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
    response_summary: get('response_summary','Response Summary'),
    attachment_url: get('attachment_url','Attachment URL','Link')
  };
}

function normalizeDate(v) {
  if (!v) return '';
  // Preserve full datetime if present (ISO format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM)
  // If only date is given, default to 09:00 to avoid timezone-induced day shifts
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return '';
    // If already looks like an ISO datetime, normalize to YYYY-MM-DDTHH:MM
    if (trimmed.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) {
      return trimmed.slice(0, 16);
    }
    // If date-only YYYY-MM-DD, add 09:00 default
    if (trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return trimmed + 'T09:00';
    }
  }
  // Try to parse as Date
  const d = new Date(v);
  if (isNaN(d)) return '';
  // Return as YYYY-MM-DDTHH:MM (local-time ISO without seconds)
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert a stored datetime string into the format an <input type="datetime-local"> expects: YYYY-MM-DDTHH:MM
function toInputDateTime(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (!s) return '';
  // Already correct format
  if (s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) return s.slice(0, 16);
  // Date-only — add T09:00 so the input shows it correctly
  if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s + 'T09:00';
  // Try parse and re-format
  const d = new Date(s);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function exportCSV() {
  const headers = ['id','region','country','customer','request_title','ticket_summary','priority','status_reason','response_done','segment','category','sub_category','created_by','resolved_by','sla_status','created_on','response_date','acceptance_date','request_type','cost_optimized','npt_reduction','production_recovery','request_description','response_summary','attachment_url'];
  const csv = Papa.unparse({ fields: headers, data: STATE.records.map(r => headers.map(h => r[h] || '')) });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  download(blob, `techhub_export_${new Date().toISOString().slice(0,10)}.csv`);
  toast('CSV exported', 'ok');
}

function exportXLSX() {
  const headers = ['ID','Region','Country','Customer','Request Title','Ticket Summary','Priority','Status','Response Done','Category','Sub-Category','Created By','Resolved By','SLA Status','Created On','Response Date','Acceptance Date','Request Type','Cost Optimized','NPT Reduction','Production Recovery','Description','Response Summary','Attachment URL'];
  const data = [headers, ...STATE.records.map(r => [r.id,r.region,r.country,r.customer,r.request_title,r.ticket_summary,r.priority,r.status_reason,r.response_done,r.category,r.sub_category,r.created_by,r.resolved_by,r.sla_status,r.created_on,r.response_date,r.acceptance_date,r.request_type,r.cost_optimized,r.npt_reduction,r.production_recovery,r.request_description,r.response_summary,r.attachment_url])];
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
    // Cache-bust: unique query string every call forces GitHub Pages to serve fresh file,
    // bypassing the browser's HTTP cache (which otherwise serves stale data.csv for hours).
    const resp = await fetch('data.csv?v=' + Date.now(), { cache: 'no-store' });
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
    console.log(`Seeded ${STATE.records.length} records from data.csv`);
  } catch(e) {
    // No data.csv — that's fine, will start empty
    console.log('No data.csv found, starting empty', e);
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

// ============================================================================
// MONTHLY REPORT DOWNLOAD (Admin only — generates APC-branded Word .doc file)
// ============================================================================
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function openReportDialog() {
  if (!STATE.isAdmin) { toast('Admin only', 'error'); return; }
  // Build list of years present in data
  const years = [...new Set(enrichedAll().filter(r => r._includeKPI && r._created).map(r => r._year))].sort().reverse();
  if (!years.length) { toast('No data to report on', 'error'); return; }
  const curYear = years[0];
  const curMonth = new Date().getMonth() + 1;

  const html = `
    <div class="modal-overlay" id="rpt-overlay">
      <div class="modal" style="max-width:460px;">
        <button class="modal-close" id="rpt-close">×</button>
        <div class="modal-title">Download Monthly Report</div>
        <p class="modal-body">Generate an APC-branded Word report. Open in Microsoft Word and <em>File → Save As → PDF</em> for a high-quality PDF.</p>
        <div class="form-grid cols-2" style="margin-top:12px;">
          <div class="field">
            <label>Report mode</label>
            <select id="rpt-mode">
              <option value="month">Per Month</option>
              <option value="ytd">Cumulative YTD</option>
            </select>
          </div>
          <div class="field">
            <label>Year</label>
            <select id="rpt-year">${years.map(y => `<option value="${y}" ${y===curYear?'selected':''}>${y}</option>`).join('')}</select>
          </div>
          <div class="field field-full" id="rpt-month-wrap">
            <label>Month</label>
            <select id="rpt-month">${MONTH_NAMES_FULL.map((n,i) => `<option value="${i+1}" ${(i+1)===curMonth?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <div class="flex gap-8" style="margin-top:16px; justify-content:flex-end;">
          <button class="btn-ghost" id="rpt-cancel">Cancel</button>
          <button class="btn-primary" id="rpt-generate">Generate &amp; Download</button>
        </div>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  document.getElementById('rpt-close').onclick = close;
  document.getElementById('rpt-cancel').onclick = close;
  document.getElementById('rpt-mode').onchange = (e) => {
    document.getElementById('rpt-month-wrap').style.display = e.target.value === 'ytd' ? 'none' : '';
  };
  document.getElementById('rpt-generate').onclick = () => {
    const mode = document.getElementById('rpt-mode').value;
    const year = parseInt(document.getElementById('rpt-year').value);
    const month = parseInt(document.getElementById('rpt-month').value);
    close();
    generateMonthlyReport(mode, year, month);
  };
}

// ---- Compute report data from filtered records ----
function computeReportKPIs(records) {
  const total = records.length;
  if (!total) return null;
  const compliant = records.filter(r => r._slaCompliant === 'Compliant').length;
  const breached = records.filter(r => r._slaCompliant === 'Breached').length;
  const resolved = records.filter(r => (r.status_reason || '').startsWith('Resolved')).length;
  const validTat = records.map(r => r._responseTAT).filter(t => t !== null && Math.abs(t) <= 720).map(Math.abs).sort((a,b)=>a-b);
  const medianTatHrs = validTat.length ? validTat[Math.floor(validTat.length/2)] : null;
  const hp = records.filter(r => r._responseTAT !== null && Math.abs(r._responseTAT) <= 720 && (r.priority==='Critical (6 Hours)' || r.priority==='High (1 Working day)')).map(r => Math.abs(r._responseTAT));
  const hpAvgHrs = hp.length ? hp.reduce((a,b)=>a+b,0)/hp.length : null;
  const countries = new Set(records.map(r => r.country).filter(Boolean)).size;
  const regions = new Set(records.map(r => r.region).filter(Boolean)).size;
  const npt = records.filter(r => (r.npt_reduction||'').toLowerCase() === 'yes').length;
  const topCountries = Object.entries(records.reduce((a,r) => { if (r.country) a[r.country] = (a[r.country]||0)+1; return a; }, {})).sort((a,b)=>b[1]-a[1]).slice(0,3).map(c=>c[0]);
  return {
    total, resolved, open: total - resolved, compliant, breached,
    compliance: (compliant+breached) ? (compliant/(compliant+breached)*100) : null,
    medianTatDays: medianTatHrs !== null ? medianTatHrs/24 : null,
    hpAvgDays: hpAvgHrs !== null ? hpAvgHrs/24 : null,
    countries, regions, npt,
    topCountries: topCountries.join(', ')
  };
}

// ---- Build HTML-based Word document (opens in Word, retains APC brand & tables) ----
function generateMonthlyReport(mode, year, month) {
  const DARK = '#4A4950', GOLD = '#D8C297', STRIP = '#EFEBE4', NEUTRAL = '#948984', BORDER = '#D5CFC5';

  // Filter records
  const all = enrichedAll().filter(r => r._includeKPI && r._year === year);
  const scoped = mode === 'month' ? all.filter(r => r._created && (r._created.getMonth()+1) === month) : all;
  if (!scoped.length) { toast(`No records in ${mode==='month' ? MONTH_NAMES_FULL[month-1]+' '+year : year+' YTD'}`, 'error'); return; }

  const K = computeReportKPIs(scoped);
  const scopeLabel = mode === 'month' ? `${MONTH_NAMES_SHORT[month-1]} ${year}` : `${year} YTD (through ${MONTH_NAMES_SHORT[new Date().getMonth()]})`;
  const reportingPeriodLabel = mode === 'month' ? `${MONTH_NAMES_FULL[month-1]} ${year}` : `${year} Year-to-Date`;

  // Aggregations
  const byRegion = countBy(scoped, 'region');
  const byCountry = countBy(scoped, 'country');
  const bySegment = countBy(scoped, 'segment');
  const byCategory = countBy(scoped, 'category');
  const bySubCategory = countBy(scoped, 'sub_category');
  const byPriority = countBy(scoped, 'priority');
  const byRequestType = countBy(scoped, 'request_type');
  const bySubmitter = countBy(scoped, 'created_by');
  const byResolver = countBy(scoped, 'resolved_by');

  // Speed by Priority (avg TAT days per priority)
  const speedByPri = {};
  ['Critical (6 Hours)','High (1 Working day)','Medium (3 Working days)','Low (5 Working days)'].forEach(p => {
    const subset = scoped.filter(r => r.priority === p && r._responseTAT !== null && Math.abs(r._responseTAT) <= 720);
    if (subset.length) {
      const avg = subset.reduce((s,r) => s + Math.abs(r._responseTAT), 0) / subset.length / 24;
      speedByPri[p] = { count: subset.length, avgDays: avg };
    }
  });

  // Monthly trend (within year)
  const trendMonths = Array.from({length: 12}, (_, i) => i+1);
  const trendCounts = trendMonths.map(m => all.filter(r => r._created && r._created.getMonth()+1 === m).length);

  // ---- Build HTML (Word-compatible with brand styling) ----
  const h = (title, data, isCount) => {
    if (!Object.keys(data).length) return `<tr><td colspan="2" style="padding:4px 8px; color:${NEUTRAL}; font-style:italic;">No data</td></tr>`;
    const sorted = Object.entries(data).sort((a,b)=>b[1]-a[1]);
    return sorted.map(([name, cnt]) => `
      <tr>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt;">${escapeHtml(name || '(blank)')}</td>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt; text-align:right; font-weight:600;">${cnt}${isCount && K.total ? ' · '+Math.round(cnt/K.total*100)+'%':''}</td>
      </tr>`).join('');
  };

  const sectionTbl = (title, rowsHtml) => `
    <table style="width:100%; border-collapse:collapse; margin-top:14px; border:1px solid ${BORDER};">
      <thead><tr><th colspan="2" style="background:${DARK}; color:#fff; padding:6px 8px; text-align:left; font-size:10pt; font-family:Arial;">■ ${escapeHtml(title)}</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>GOS-Tech Hub Monthly Report - ${scopeLabel}</title>
  <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
  <style>
    @page { size: 8.5in 11in; margin: 0.5in; }
    body { font-family: Arial, sans-serif; color: ${DARK}; margin: 0; padding: 0; font-size: 10pt; }
    .header { display: table; width: 100%; margin-bottom: 8px; }
    .logo-cell { display: table-cell; vertical-align: middle; width: 50%; }
    .period-cell { display: table-cell; vertical-align: middle; text-align: right; font-weight: 700; font-size: 11pt; }
    h1 { font-size: 22pt; color: ${DARK}; margin: 8px 0 4px; font-weight: 700; }
    .subtitle { font-style: italic; color: ${NEUTRAL}; font-size: 10pt; margin-bottom: 10px; }
    .summary-strip { background: ${STRIP}; border: 1px solid ${BORDER}; padding: 10px 14px; display: table; width: 100%; margin: 6px 0; }
    .narrative { display: table-cell; vertical-align: middle; width: 72%; font-size: 10pt; line-height: 1.4; }
    .badge { display: table-cell; vertical-align: middle; width: 28%; text-align: center; background: ${GOLD}; padding: 10px; font-weight: 700; font-size: 11pt; }
    .kpi-row { display: table; width: 100%; margin: 12px 0; border-collapse: collapse; }
    .kpi-cell { display: table-cell; width: 16.6%; text-align: center; padding: 6px 4px; }
    .kpi-big { font-size: 20pt; font-weight: 700; color: ${DARK}; }
    .kpi-label { font-size: 7pt; font-weight: 700; color: ${DARK}; letter-spacing: 0.5pt; }
    .kpi-sub { font-size: 7pt; color: ${NEUTRAL}; }
    .footer-line { text-align: center; color: ${NEUTRAL}; font-size: 8pt; margin-top: 18px; }
  </style>
</head>
<body>

  <div class="header">
    <div class="logo-cell">
      <img src="${APC_LOGO_B64}" width="140" alt="Alkhorayef"/>
    </div>
    <div class="period-cell">Reporting period: ${reportingPeriodLabel}</div>
  </div>

  <h1>GOS-Tech Hub monthly report</h1>
  <div class="subtitle">Technical Request Performance  ·  ${scopeLabel}  ·  Executive Summary</div>

  <div class="summary-strip">
    <div class="narrative">
      In ${reportingPeriodLabel} the GOS-Tech Hub processed ${K.total} technical requests across ${K.countries} countries and ${K.regions} regions,
      achieving ${K.compliance == null ? 'N/A' : K.compliance.toFixed(0)+'%'} SLA compliance with a
      ${K.medianTatDays == null ? 'N/A' : K.medianTatDays.toFixed(1)+'-day'} median turnaround${K.npt ? ', with '+K.npt+' request'+(K.npt===1?'':'s')+' reducing NPT' : ''},
      covering technical support activity across ${escapeHtml(K.topCountries || 'multiple countries')},
      directly supporting rig time, run-life and customer confidence.
    </div>
    <div class="badge">${Math.round(K.resolved/K.total*100)}% RESOLVED  ·  ${K.open} OPEN</div>
  </div>

  <table class="kpi-row">
    <tr>
      <td class="kpi-cell">
        <div class="kpi-big">${K.total}</div>
        <div class="kpi-label">REQUESTS RESOLVED</div>
        <div class="kpi-sub">${Math.round(K.resolved/K.total*100)}% closure</div>
      </td>
      <td class="kpi-cell">
        <div class="kpi-big">${K.compliance == null ? '—' : K.compliance.toFixed(0)+'%'}</div>
        <div class="kpi-label">SLA COMPLIANCE</div>
        <div class="kpi-sub">${K.compliant} met · ${K.breached} missed</div>
      </td>
      <td class="kpi-cell">
        <div class="kpi-big">${K.medianTatDays == null ? '—' : K.medianTatDays.toFixed(1)+' d'}</div>
        <div class="kpi-label">MEDIAN TURNAROUND</div>
        <div class="kpi-sub">${K.medianTatDays == null ? '' : '~'+Math.max(1, Math.round(K.medianTatDays))+' day typical'}</div>
      </td>
      <td class="kpi-cell">
        <div class="kpi-big">${K.hpAvgDays == null ? '—' : K.hpAvgDays.toFixed(2)+' d'}</div>
        <div class="kpi-label">HIGH-PRIORITY AVG</div>
        <div class="kpi-sub">${K.hpAvgDays == null ? '' : (K.hpAvgDays < 1 ? '<1 day response' : '')}</div>
      </td>
      <td class="kpi-cell">
        <div class="kpi-big">${K.countries}</div>
        <div class="kpi-label">COUNTRIES SERVED</div>
        <div class="kpi-sub">${K.regions} regions</div>
      </td>
      <td class="kpi-cell">
        <div class="kpi-big">${K.npt}</div>
        <div class="kpi-label">NPT-REDUCTION WINS</div>
        <div class="kpi-sub">${K.npt ? 'value delivered' : 'none this period'}</div>
      </td>
    </tr>
  </table>

  ${sectionTbl('Volume by Region', h('Region', byRegion, true))}
  ${sectionTbl('Volume by Country (Business Unit)', h('Country', byCountry, true))}
  ${sectionTbl('Volume by Segment', h('Segment', bySegment, true))}
  ${sectionTbl('Volume by Technical Category', h('Category', byCategory, true))}
  ${sectionTbl('Volume by Sub-Category', h('Sub-Category', bySubCategory, true))}
  ${sectionTbl('Volume by Priority', h('Priority', byPriority, true))}
  ${sectionTbl('Volume by Request Type', h('Request Type', byRequestType, true))}
  ${sectionTbl('Speed by Priority (avg response days)',
    Object.entries(speedByPri).map(([pri, d]) => `
      <tr>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt;">${escapeHtml(pri)} · ${d.count} tickets</td>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt; text-align:right; font-weight:600;">${d.avgDays.toFixed(2)} d</td>
      </tr>`).join('') || `<tr><td colspan="2" style="padding:4px 8px; color:${NEUTRAL}; font-style:italic;">No TAT data</td></tr>`
  )}
  ${sectionTbl(`Monthly volume trend — ${year}`,
    trendMonths.map((m, i) => `
      <tr>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt;">${MONTH_NAMES_FULL[i]}${mode==='month' && m===month ? ' (focus)' : ''}</td>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt; text-align:right; font-weight:${(mode==='month' && m===month)?'700':'600'}; ${(mode==='month' && m===month)?'background:'+GOLD+';':''}">${trendCounts[i]}</td>
      </tr>`).join('')
  )}
  ${sectionTbl('Top 5 Submitters',
    Object.entries(bySubmitter).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([n,c]) => `
      <tr>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt;">${escapeHtml(n || '(blank)')}</td>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt; text-align:right; font-weight:600;">${c} · ${Math.round(c/K.total*100)}%</td>
      </tr>`).join('') || '<tr><td colspan="2">No data</td></tr>'
  )}
  ${sectionTbl('Top 5 Responders (Resolvers)',
    Object.entries(byResolver).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([n,c]) => `
      <tr>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt;">${escapeHtml(n || '(blank)')}</td>
        <td style="padding:3px 8px; border-bottom:1px solid ${BORDER}; font-size:9pt; text-align:right; font-weight:600;">${c} · ${Math.round(c/K.total*100)}%</td>
      </tr>`).join('') || '<tr><td colspan="2">No data</td></tr>'
  )}

  <div class="footer-line">
    © Alkhorayef Petroleum Company - Confidential · Controlled Document<br>
    <em>Always producing.</em>
  </div>

</body>
</html>`;

  // Download as .doc (opens in Word with brand styling intact)
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fname = mode === 'month' ? `GOS-TechHub_Report_${year}-${String(month).padStart(2,'0')}_${MONTH_NAMES_SHORT[month-1]}.doc` : `GOS-TechHub_Report_${year}_YTD.doc`;
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  toast(`Report generated: ${fname}. Open in Word, then File → Save As → PDF for a high-quality PDF.`, 'ok');
}

function countBy(records, field) {
  const o = {};
  records.forEach(r => {
    const v = (r[field] || '').trim();
    if (v) o[v] = (o[v] || 0) + 1;
  });
  return o;
}

// APC logo (base64 PNG) — colored two-half-disc + "Alkhorayef" wordmark
const APC_LOGO_B64 = 'data:image/png;base64,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';

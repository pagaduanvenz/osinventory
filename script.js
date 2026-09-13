(function () {
'use strict';

var API_URL = localStorage.getItem('onesecai_api_url');
var USER = JSON.parse(localStorage.getItem('onesecai_user') || 'null');

if (!API_URL || !USER) { window.location.href = 'login.html'; return; }

document.getElementById('who-name').textContent = USER.Name || USER.Username;
document.getElementById('who-role').textContent = USER.Role;
document.getElementById('logout-btn').addEventListener('click', function () {
  localStorage.removeItem('onesecai_user');
  window.location.href = 'login.html';
});

var menuToggle = document.getElementById('menu-toggle');
var sidebar = document.getElementById('sidebar');
menuToggle.addEventListener('click', function () { sidebar.classList.toggle('open'); });
document.getElementById('content').addEventListener('click', function () { sidebar.classList.remove('open'); });

// ---------------- API layer (with short-lived cache + progress indicator) ----------------
var CACHE_TTL = 45000; // ms — long enough to skip refetches when flipping between views, short enough to stay fresh
var _cache = {};
function cacheGet(entity) {
  var c = _cache[entity];
  return (c && (Date.now() - c.ts < CACHE_TTL)) ? c.data : null;
}
function cacheSet(entity, data) { _cache[entity] = { data: data, ts: Date.now() }; return data; }
function cacheInvalidate(entities) {
  (Array.isArray(entities) ? entities : [entities]).forEach(function (e) { delete _cache[e]; });
}

var pendingRequests = 0;
var progressBar = document.getElementById('top-progress');
function beginRequest() { pendingRequests++; if (progressBar) progressBar.hidden = false; }
function endRequest() { pendingRequests = Math.max(0, pendingRequests - 1); if (progressBar && pendingRequests === 0) progressBar.hidden = true; }

var api = {
  _get: function (params) {
    var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    beginRequest();
    return fetch(API_URL + '?' + qs).then(function (r) { return r.json(); }).then(unwrap).finally(endRequest);
  },
  _post: function (body) {
    beginRequest();
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(unwrap).finally(endRequest);
  },
  list: function (entity, opts) {
    opts = opts || {};
    if (!opts.force) { var cached = cacheGet(entity); if (cached) return Promise.resolve(cached); }
    return api._get({ action: 'list', entity: entity }).then(function (data) { return cacheSet(entity, data); });
  },
  bootstrap: function () { return api._get({ action: 'bootstrap' }); },
  dashboard: function () { return api._get({ action: 'dashboard' }); },
  serialHistory: function (serial) { return api._get({ action: 'serialHistory', serial: serial }); },
  itemLookup: function (value) { return api._get({ action: 'itemLookup', value: value }); },
  modelLookup: function (value) { return api._get({ action: 'modelLookup', value: value }); },
  create: function (entity, record) { return api._post({ action: 'create', entity: entity, record: record }).then(function (r) { cacheInvalidate(entity); return r; }); },
  update: function (entity, id, record) { return api._post({ action: 'update', entity: entity, id: id, record: record }).then(function (r) { cacheInvalidate(entity); return r; }); },
  remove: function (entity, id) { return api._post({ action: 'delete', entity: entity, id: id }).then(function (r) { cacheInvalidate(entity); return r; }); },
  receiveStock: function (payload) { return api._post({ action: 'receiveStock', payload: payload }).then(function (r) { cacheInvalidate(['Items', 'StockMovements']); return r; }); },
  moveItem: function (payload) { return api._post({ action: 'moveItem', payload: payload }).then(function (r) { cacheInvalidate(['Items', 'StockMovements']); return r; }); },
  createDelivery: function (payload) { return api._post({ action: 'createDelivery', payload: payload }).then(function (r) { cacheInvalidate(['Items', 'StockMovements', 'Deliveries', 'DeliveryItems']); return r; }); },
  createInstallation: function (payload) { return api._post({ action: 'createInstallation', payload: payload }).then(function (r) { cacheInvalidate(['Items', 'StockMovements', 'Installations', 'InstallationItems']); return r; }); },
  bulkReceiveStock: function (payload) { return api._post({ action: 'bulkReceiveStock', payload: payload }).then(function (r) { cacheInvalidate(['Items', 'StockMovements']); return r; }); },
  bulkMoveItems: function (payload) { return api._post({ action: 'bulkMoveItems', payload: payload }).then(function (r) { cacheInvalidate(['Items', 'StockMovements']); return r; }); }
};
function unwrap(res) {
  if (!res.ok) { throw new Error(res.error || 'Request failed'); }
  return res.data;
}

// Warm the cache once at startup so the first few view switches don't wait on the network at all.
api.bootstrap().then(function (data) {
  Object.keys(data).forEach(function (k) { cacheSet(k, data[k]); });
}).catch(function () { /* views fall back to fetching individually */ });

function withLoading(promise) {
  var banner = document.getElementById('loading-banner');
  banner.hidden = false;
  return promise.finally(function () { banner.hidden = true; });
}

function toast(msg, isError) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.hidden = true; }, 3200);
}

function hashPassword(text) {
  var enc = new TextEncoder().encode(text);
  return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}

// ---------------- Modal helper ----------------
var overlay = document.getElementById('modal-overlay');
var modalTitle = document.getElementById('modal-title');
var modalBody = document.getElementById('modal-body');
document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
function closeModal() { overlay.hidden = true; modalBody.innerHTML = ''; }
function openModal(title, bodyNode) {
  modalTitle.textContent = title;
  modalBody.innerHTML = '';
  modalBody.appendChild(bodyNode);
  overlay.hidden = false;
}

/** Build a form from a field spec list. Returns {form, getValues()} */
function buildForm(fields, values) {
  values = values || {};
  var form = document.createElement('form');
  var inputs = {};
  fields.forEach(function (f) {
    var wrap = document.createElement('div');
    wrap.className = 'field' + (f.type === 'checkbox' ? ' checkbox-field' : '');
    var label = document.createElement('label');
    label.textContent = f.label;
    var input;
    if (f.type === 'select') {
      input = document.createElement('select');
      (f.options || []).forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.label;
        input.appendChild(o);
      });
    } else if (f.type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
    }
    input.name = f.name;
    if (f.type === 'checkbox') {
      input.checked = !!values[f.name];
      wrap.appendChild(input); wrap.appendChild(label);
    } else {
      if (values[f.name] !== undefined) input.value = values[f.name];
      wrap.appendChild(label); wrap.appendChild(input);
    }
    if (f.required) input.required = true;
    inputs[f.name] = input;
    form.appendChild(wrap);
  });
  return {
    form: form,
    getValues: function () {
      var out = {};
      fields.forEach(function (f) {
        out[f.name] = f.type === 'checkbox' ? inputs[f.name].checked : inputs[f.name].value;
      });
      return out;
    }
  };
}

// ---------------- Table helper ----------------
function renderTable(container, columns, rows, opts) {
  opts = opts || {};
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state"><strong>Nothing here yet</strong>' + (opts.emptyHint || 'Add your first record to get started.') + '</div>';
    return;
  }
  var wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  var table = document.createElement('table');
  var thead = document.createElement('thead');
  var htr = document.createElement('tr');
  columns.forEach(function (c) { var th = document.createElement('th'); th.textContent = c.label; htr.appendChild(th); });
  if (opts.actions) { var th2 = document.createElement('th'); th2.textContent = ''; htr.appendChild(th2); }
  thead.appendChild(htr); table.appendChild(thead);
  var tbody = document.createElement('tbody');
  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    columns.forEach(function (c) {
      var td = document.createElement('td');
      if (c.render) { td.innerHTML = c.render(row); } else {
        td.textContent = row[c.key] === undefined ? '' : row[c.key];
        if (c.mono) td.className = 'mono';
      }
      tr.appendChild(td);
    });
    if (opts.actions) {
      var td3 = document.createElement('td');
      var div = document.createElement('div');
      div.className = 'row-actions';
      opts.actions.forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'btn btn-sm ' + (a.cls || 'btn-secondary');
        b.textContent = a.label;
        b.addEventListener('click', function () { a.onClick(row); });
        div.appendChild(b);
      });
      td3.appendChild(div);
      tr.appendChild(td3);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.innerHTML = '';
  container.appendChild(wrap);
}

function statusBadge(status) {
  var cls = 'badge-' + String(status || '').toLowerCase().replace(/\s+/g, '-');
  return '<span class="badge ' + cls + '">' + status + '</span>';
}

/** Shows animated placeholder rows in a container while its real data is still loading. */
function renderSkeleton(container, rows) {
  rows = rows || 5;
  var widths = ['92%', '78%', '85%', '65%', '90%'];
  var html = '<div class="skeleton-table">';
  for (var i = 0; i < rows; i++) html += '<div class="skeleton-row" style="width:' + widths[i % widths.length] + '"></div>';
  html += '</div>';
  container.innerHTML = html;
}

// ---------------- View router ----------------
var root = document.getElementById('view-root');
var navButtons = document.querySelectorAll('.nav-item');
navButtons.forEach(function (btn) {
  btn.addEventListener('click', function () { navigate(btn.dataset.view); });
});

var bottomTabs = document.querySelectorAll('.bottom-tab[data-view]');
bottomTabs.forEach(function (btn) {
  btn.addEventListener('click', function () { navigate(btn.dataset.view); });
});
document.getElementById('bottom-tab-menu').addEventListener('click', function () { sidebar.classList.toggle('open'); });

var VIEWS = {
  dashboard: viewDashboard,
  items: viewItems,
  models: viewModels,
  scan: viewScan,
  movements: viewMovements,
  receive: viewReceive,
  bulk: viewBulk,
  deliveries: viewDeliveries,
  installations: viewInstallations,
  clients: viewMasterData.bind(null, 'Clients', 'ClientID', clientFields()),
  suppliers: viewMasterData.bind(null, 'Suppliers', 'SupplierID', supplierFields()),
  'stock-monitor': viewStockMonitor,
  reports: viewReports,
  users: viewUsers,
  settings: viewSettings,
  audit: viewAudit
};

function navigate(view) {
  navButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
  bottomTabs.forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
  sidebar.classList.remove('open');
  root.innerHTML = '';
  window.scanner && window.scanner.stop && window.scanner.stop().catch(function () {});
  (VIEWS[view] || viewDashboard)();
  location.hash = view;
}

navigate((location.hash || '#dashboard').slice(1));

function head(title, subtitle, actionLabel, onAction) {
  var wrap = document.createElement('div');
  wrap.className = 'view-head';
  var left = document.createElement('div');
  left.innerHTML = '<h1>' + title + '</h1>' + (subtitle ? '<p>' + subtitle + '</p>' : '');
  wrap.appendChild(left);
  if (actionLabel) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = actionLabel;
    btn.addEventListener('click', onAction);
    wrap.appendChild(btn);
  }
  root.appendChild(wrap);
}

// ---------------- Dashboard ----------------
function viewDashboard() {
  head('Dashboard', 'A live snapshot of every unit in the field.');
  var grid = document.createElement('div'); grid.className = 'stat-grid'; root.appendChild(grid);
  var panels = document.createElement('div'); panels.style.display = 'grid'; panels.style.gridTemplateColumns = '1fr 1fr'; panels.style.gap = '20px'; root.appendChild(panels);
  var lowPanel = document.createElement('div'); lowPanel.className = 'panel'; lowPanel.innerHTML = '<h2>Low stock</h2><div id="low-stock-body"></div>';
  var movePanel = document.createElement('div'); movePanel.className = 'panel'; movePanel.innerHTML = '<h2>Recent movements</h2><div id="recent-moves-body"></div>';
  panels.appendChild(lowPanel); panels.appendChild(movePanel);

  withLoading(api.dashboard()).then(function (d) {
    var order = ['Available', 'Reserved', 'Out for Delivery', 'Delivered', 'For Installation', 'Installed', 'Returned', 'For Repair', 'Damaged', 'Lost', 'Disposed'];
    var cards = [{ n: d.totalItems, l: 'Total items' }];
    order.forEach(function (s) { if (d.statusCounts[s]) cards.push({ n: d.statusCounts[s], l: s }); });
    grid.innerHTML = cards.map(function (c) { return '<div class="stat-card"><div class="n">' + c.n + '</div><div class="l">' + c.l + '</div></div>'; }).join('');

    var lowBody = document.getElementById('low-stock-body');
    if (!d.lowStock.length) { lowBody.innerHTML = '<p style="color:var(--ink-muted);font-size:13.5px;">All models are above their minimum stock threshold.</p>'; }
    else { renderTable(lowBody, [{ key: 'ModelName', label: 'Model' }, { key: 'MinStock', label: 'Min stock' }], d.lowStock); }

    var moveBody = document.getElementById('recent-moves-body');
    renderTable(moveBody, [
      { key: 'SerialNumber', label: 'Serial', mono: true },
      { label: 'Change', render: function (r) { return statusBadge(r.PrevStatus) + ' → ' + statusBadge(r.NewStatus); } },
      { key: 'DateTime', label: 'When', render: function (r) { return fmtDate(r.DateTime); } }
    ], d.recentMoves);
  }).catch(function (e) { toast(e.message, true); });
}

function fmtDate(v) { try { return new Date(v).toLocaleString(); } catch (e) { return v; } }

// ---------------- Items ----------------
var STATUS_OPTIONS = ['Available', 'Reserved', 'Out for Delivery', 'Delivered', 'For Installation', 'Installed', 'Returned', 'For Repair', 'Damaged', 'Lost', 'Disposed'];
var CONDITION_OPTIONS = ['New', 'Good', 'Used', 'Damaged', 'Defective', 'For Repair'];

function viewItems() {
  head('Items', 'Every physical unit, tracked by its own serial number.', 'Add item manually', function () { openItemForm(); });
  var filterBar = document.createElement('div'); filterBar.className = 'filter-bar';
  filterBar.innerHTML =
    '<input type="text" id="f-search" placeholder="Search serial, barcode, item ID…">' +
    '<select id="f-status"><option value="">All statuses</option>' + STATUS_OPTIONS.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>';
  root.appendChild(filterBar);
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);

  var allItems = [], allModels = [];
  withLoading(Promise.all([api.list('Items'), api.list('Models')])).then(function (res) {
    allItems = res[0]; allModels = res[1];
    draw();
  }).catch(function (e) { toast(e.message, true); });

  filterBar.querySelector('#f-search').addEventListener('input', draw);
  filterBar.querySelector('#f-status').addEventListener('change', draw);

  function draw() {
    var q = (filterBar.querySelector('#f-search').value || '').toLowerCase();
    var st = filterBar.querySelector('#f-status').value;
    var rows = allItems.filter(function (it) {
      var matchQ = !q || (it.SerialNumber + it.Barcode + it.ItemID).toLowerCase().indexOf(q) !== -1;
      var matchS = !st || it.Status === st;
      return matchQ && matchS;
    });
    renderTable(tableHost, [
      { key: 'ItemID', label: 'Item ID', mono: true },
      { label: 'Model', render: function (r) { var m = allModels.find(function (x) { return x.ModelID === r.ModelID; }); return m ? m.ModelName : r.ModelID; } },
      { key: 'SerialNumber', label: 'Serial', mono: true },
      { key: 'Barcode', label: 'Barcode', mono: true },
      { label: 'Status', render: function (r) { return statusBadge(r.Status); } },
      { key: 'Condition', label: 'Condition' },
      { key: 'Location', label: 'Location' }
    ], rows, {
      actions: [
        { label: 'Move', onClick: function (r) { openMoveForm(r); } },
        { label: 'Edit', onClick: function (r) { openItemForm(r); } },
        { label: 'Delete', cls: 'btn-danger', onClick: function (r) {
          if (!confirm('Delete item ' + r.ItemID + '?')) return;
          withLoading(api.remove('Items', r.ItemID)).then(function () { toast('Item deleted'); navigate('items'); }).catch(function (e) { toast(e.message, true); });
        } }
      ]
    });
  }

  function openItemForm(existing) {
    var fields = [
      { name: 'ModelID', label: 'Model', type: 'select', options: allModels.map(function (m) { return { value: m.ModelID, label: m.ModelName }; }), required: true },
      { name: 'SerialNumber', label: 'Serial number', required: true },
      { name: 'Barcode', label: 'Barcode (usually inherited from model)' },
      { name: 'Status', label: 'Status', type: 'select', options: STATUS_OPTIONS.map(function (s) { return { value: s, label: s }; }) },
      { name: 'Condition', label: 'Condition', type: 'select', options: CONDITION_OPTIONS.map(function (c) { return { value: c, label: c }; }) },
      { name: 'Location', label: 'Location', required: true }
    ];
    var f = buildForm(fields, existing || { Status: 'Available', Condition: 'New', Location: 'Main Warehouse' });
    var submit = document.createElement('div'); submit.className = 'form-actions';
    submit.innerHTML = '<button type="button" class="btn btn-secondary" id="cancel">Cancel</button><button class="btn btn-primary">' + (existing ? 'Save changes' : 'Add item') + '</button>';
    f.form.appendChild(submit);
    submit.querySelector('#cancel').addEventListener('click', closeModal);
    f.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = f.getValues();
      if (!v.Barcode) { var m = allModels.find(function (x) { return x.ModelID === v.ModelID; }); v.Barcode = m ? m.Barcode : ''; }
      var op = existing ? api.update('Items', existing.ItemID, v) : api.create('Items', Object.assign(v, { CreatedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString() }));
      withLoading(op).then(function () { closeModal(); toast(existing ? 'Item updated' : 'Item added'); navigate('items'); }).catch(function (e) { toast(e.message, true); });
    });
    openModal(existing ? 'Edit item' : 'Add item', f.form);
  }

  function openMoveForm(item) {
    var fields = [
      { name: 'NewStatus', label: 'New status', type: 'select', options: STATUS_OPTIONS.map(function (s) { return { value: s, label: s }; }) },
      { name: 'NewCondition', label: 'New condition', type: 'select', options: CONDITION_OPTIONS.map(function (c) { return { value: c, label: c }; }) },
      { name: 'ToLocation', label: 'Location' },
      { name: 'Remarks', label: 'Remarks', type: 'textarea' }
    ];
    var f = buildForm(fields, { NewStatus: item.Status, NewCondition: item.Condition, ToLocation: item.Location });
    var submit = document.createElement('div'); submit.className = 'form-actions';
    submit.innerHTML = '<button type="button" class="btn btn-secondary" id="cancel">Cancel</button><button class="btn btn-primary">Record movement</button>';
    f.form.appendChild(submit);
    submit.querySelector('#cancel').addEventListener('click', closeModal);
    f.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = f.getValues();
      v.ItemID = item.ItemID; v.User = USER.Username;
      withLoading(api.moveItem(v)).then(function () { closeModal(); toast('Movement recorded'); navigate('items'); }).catch(function (e) { toast(e.message, true); });
    });
    openModal('Move ' + item.SerialNumber, f.form);
  }
}

// ---------------- Models ----------------
function viewModels() {
  head('Models', 'Product types — each with one shared barcode.', 'Add model', function () { openForm(); });
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);
  var rows = [];
  withLoading(api.list('Models')).then(function (r) { rows = r; draw(); }).catch(function (e) { toast(e.message, true); });

  function draw() {
    renderTable(tableHost, [
      { key: 'ModelID', label: 'Model ID', mono: true },
      { key: 'ModelName', label: 'Name' },
      { key: 'Category', label: 'Category' },
      { key: 'Brand', label: 'Brand' },
      { key: 'Barcode', label: 'Barcode', mono: true },
      { key: 'MinStock', label: 'Min stock' },
      { label: 'Active', render: function (r) { return r.Active ? 'Yes' : 'No'; } }
    ], rows, {
      actions: [
        { label: 'Edit', onClick: openForm },
        { label: 'Delete', cls: 'btn-danger', onClick: function (r) {
          if (!confirm('Delete model ' + r.ModelName + '?')) return;
          withLoading(api.remove('Models', r.ModelID)).then(function () { toast('Model deleted'); navigate('models'); }).catch(function (e) { toast(e.message, true); });
        } }
      ]
    });
  }

  function openForm(existing) {
    var fields = [
      { name: 'ModelName', label: 'Model name', required: true },
      { name: 'Category', label: 'Category' },
      { name: 'Brand', label: 'Brand' },
      { name: 'Barcode', label: 'Barcode', required: true },
      { name: 'Unit', label: 'Unit (e.g. piece)' },
      { name: 'MinStock', label: 'Minimum stock', type: 'number' },
      { name: 'Description', label: 'Description', type: 'textarea' },
      { name: 'Active', label: 'Active', type: 'checkbox' }
    ];
    var f = buildForm(fields, existing || { Active: true, Unit: 'Piece', MinStock: 5 });
    var submit = document.createElement('div'); submit.className = 'form-actions';
    submit.innerHTML = '<button type="button" class="btn btn-secondary" id="cancel">Cancel</button><button class="btn btn-primary">' + (existing ? 'Save changes' : 'Add model') + '</button>';
    f.form.appendChild(submit);
    submit.querySelector('#cancel').addEventListener('click', closeModal);
    f.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = f.getValues();
      var op = existing ? api.update('Models', existing.ModelID, v) : api.create('Models', v);
      withLoading(op).then(function () { closeModal(); toast(existing ? 'Model updated' : 'Model added'); navigate('models'); }).catch(function (e) { toast(e.message, true); });
    });
    openModal(existing ? 'Edit model' : 'Add model', f.form);
  }
}

// ---------------- Scan / Lookup ----------------
function viewScan() {
  head('Scan / Lookup', 'Use your camera, a USB scanner, or type a code — all three land in the same box.');
  var grid = document.createElement('div'); grid.className = 'scan-grid'; root.appendChild(grid);

  var left = document.createElement('div');
  left.innerHTML =
    '<div class="field"><label>Scan or type a serial number / barcode</label>' +
    '<input type="text" id="scan-input" placeholder="Focus here, then use a USB scanner — or type and press Enter" autofocus></div>' +
    '<button class="btn btn-secondary" id="camera-toggle">Start camera scan</button>' +
    '<div id="qr-reader" style="margin-top:14px;"></div>';
  grid.appendChild(left);

  var right = document.createElement('div');
  right.className = 'scan-result';
  right.innerHTML = '<p style="color:var(--ink-muted);">Results will appear here.</p>';
  grid.appendChild(right);

  var input = left.querySelector('#scan-input');
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && input.value.trim()) { lookup(input.value.trim()); input.value = ''; }
  });

  var html5Qr = null;
  left.querySelector('#camera-toggle').addEventListener('click', function (btn) {
    var button = left.querySelector('#camera-toggle');
    if (html5Qr) {
      html5Qr.stop().then(function () { html5Qr = null; button.textContent = 'Start camera scan'; });
      return;
    }
    html5Qr = new Html5Qrcode('qr-reader');
    window.scanner = html5Qr;
    button.textContent = 'Stop camera scan';
    html5Qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, function (text) {
      lookup(text);
    }).catch(function () { toast('Could not start camera. Check permissions.', true); });
  });

  function lookup(value) {
    withLoading(api.itemLookup(value)).then(function (rows) {
      if (!rows.length) { right.innerHTML = '<p><strong>No match</strong> for <span class="mono">' + value + '</span>.</p>'; return; }
      var item = rows[0];
      Promise.all([api.serialHistory(item.SerialNumber), api.list('Models')]).then(function (res) {
        var history = res[0], model = res[1].find(function (m) { return m.ModelID === item.ModelID; });
        right.innerHTML =
          '<h2 class="mono">' + item.SerialNumber + '</h2>' +
          '<p>' + (model ? model.ModelName : item.ModelID) + ' — ' + statusBadge(item.Status) + ' · ' + item.Condition + '</p>' +
          '<p style="color:var(--ink-muted);font-size:13px;">Location: ' + item.Location + '</p>' +
          '<h3 style="font-size:13px;margin-top:16px;">History</h3>' +
          '<div id="scan-history"></div>' +
          '<button class="btn btn-primary btn-sm" id="scan-move" style="margin-top:12px;">Record a movement</button>';
        renderTable(right.querySelector('#scan-history'), [
          { label: 'Change', render: function (r) { return statusBadge(r.PrevStatus || '—') + ' → ' + statusBadge(r.NewStatus); } },
          { key: 'DateTime', label: 'When', render: function (r) { return fmtDate(r.DateTime); } }
        ], history);
        right.querySelector('#scan-move').addEventListener('click', function () { navigate('items'); document.getElementById('f-search').value = item.SerialNumber; document.getElementById('f-search').dispatchEvent(new Event('input')); });
      });
    }).catch(function (e) { toast(e.message, true); });
  }
}

// ---------------- Movements ----------------
function viewMovements() {
  head('Movements', 'Full audit trail of every status and location change.');
  var filterBar = document.createElement('div'); filterBar.className = 'filter-bar';
  filterBar.innerHTML = '<input type="text" id="f-serial" placeholder="Filter by serial number">';
  root.appendChild(filterBar);
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);
  var rows = [];
  withLoading(api.list('StockMovements')).then(function (r) {
    rows = r.sort(function (a, b) { return new Date(b.DateTime) - new Date(a.DateTime); });
    draw();
  }).catch(function (e) { toast(e.message, true); });
  filterBar.querySelector('#f-serial').addEventListener('input', draw);

  function draw() {
    var q = (filterBar.querySelector('#f-serial').value || '').toLowerCase();
    var filtered = rows.filter(function (r) { return !q || String(r.SerialNumber).toLowerCase().indexOf(q) !== -1; });
    renderTable(tableHost, [
      { key: 'DateTime', label: 'When', render: function (r) { return fmtDate(r.DateTime); } },
      { key: 'SerialNumber', label: 'Serial', mono: true },
      { label: 'Change', render: function (r) { return statusBadge(r.PrevStatus || '—') + ' → ' + statusBadge(r.NewStatus); } },
      { label: 'Location', render: function (r) { return (r.FromLocation || '—') + ' → ' + r.ToLocation; } },
      { key: 'RefNo', label: 'Reference', mono: true },
      { key: 'User', label: 'By' },
      { key: 'Remarks', label: 'Remarks' }
    ], filtered);
  }
}

// ---------------- Receive stock ----------------
function viewReceive() {
  head('Receive Stock', 'Receiving creates one individually serialized record per unit.');
  var panel = document.createElement('div'); panel.className = 'panel'; root.appendChild(panel);
  var models = [];
  withLoading(api.list('Models')).then(function (r) {
    models = r;
    var fields = [
      { name: 'ModelID', label: 'Model', type: 'select', options: models.map(function (m) { return { value: m.ModelID, label: m.ModelName }; }), required: true },
      { name: 'Quantity', label: 'Quantity received', type: 'number', required: true },
      { name: 'SerialPrefix', label: 'Serial number prefix (optional)' },
      { name: 'Location', label: 'Location', required: true },
      { name: 'Remarks', label: 'Remarks', type: 'textarea' }
    ];
    var f = buildForm(fields, { Location: 'Main Warehouse', Quantity: 1 });
    var submit = document.createElement('div'); submit.className = 'form-actions';
    submit.innerHTML = '<button class="btn btn-primary">Receive stock</button>';
    f.form.appendChild(submit);
    f.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = f.getValues(); v.User = USER.Username;
      withLoading(api.receiveStock(v)).then(function (created) {
        toast(created.length + ' item(s) received');
        f.form.reset();
      }).catch(function (e) { toast(e.message, true); });
    });
    panel.appendChild(f.form);
  }).catch(function (e) { toast(e.message, true); });
}

// ---------------- Bulk Update (scan → add or update → batch submit) ----------------
function viewBulk() {
  head('Bulk Update', 'Scan each item, choose add or update, then submit the whole batch at once.');

  var scanPanel = document.createElement('div'); scanPanel.className = 'panel';
  scanPanel.innerHTML =
    '<h2>Scan or type a code</h2>' +
    '<div class="field"><input type="text" id="bulk-scan" placeholder="Scan a serial number or barcode, or type it and press Enter" autofocus></div>' +
    '<button class="btn btn-secondary btn-sm" id="bulk-camera">Start camera scan</button>' +
    '<div id="bulk-qr-reader" style="margin-top:12px;max-width:320px;"></div>' +
    '<div id="bulk-resolver" style="margin-top:14px;"></div>';
  root.appendChild(scanPanel);

  var queuesWrap = document.createElement('div');
  queuesWrap.style.display = 'grid'; queuesWrap.style.gridTemplateColumns = '1fr 1fr'; queuesWrap.style.gap = '20px';
  var receivePanel = document.createElement('div'); receivePanel.className = 'panel';
  receivePanel.innerHTML = '<h2>Pending stock to receive</h2><div id="bulk-receive-table"></div>';
  var movePanel = document.createElement('div'); movePanel.className = 'panel';
  movePanel.innerHTML = '<h2>Pending item updates</h2><div id="bulk-move-table"></div>';
  queuesWrap.appendChild(receivePanel); queuesWrap.appendChild(movePanel);
  root.appendChild(queuesWrap);

  var submitWrap = document.createElement('div'); submitWrap.className = 'form-actions'; submitWrap.style.justifyContent = 'flex-start';
  submitWrap.innerHTML = '<button class="btn btn-primary" id="bulk-submit">Submit batch</button>';
  root.appendChild(submitWrap);

  var models = [], allItems = [];
  var receiveQueue = [], moveQueue = [];
  var scanInput = scanPanel.querySelector('#bulk-scan');
  var resolver = scanPanel.querySelector('#bulk-resolver');

  withLoading(Promise.all([api.list('Models'), api.list('Items')])).then(function (res) {
    models = res[0]; allItems = res[1];
  }).catch(function (e) { toast(e.message, true); });

  scanInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && scanInput.value.trim()) { resolve(scanInput.value.trim()); scanInput.value = ''; }
  });

  var html5Qr = null;
  scanPanel.querySelector('#bulk-camera').addEventListener('click', function () {
    var button = scanPanel.querySelector('#bulk-camera');
    if (html5Qr) { html5Qr.stop().then(function () { html5Qr = null; button.textContent = 'Start camera scan'; }); return; }
    html5Qr = new Html5Qrcode('bulk-qr-reader');
    window.scanner = html5Qr;
    button.textContent = 'Stop camera scan';
    html5Qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: 200 }, function (text) { resolve(text); }).catch(function () { toast('Could not start camera. Check permissions.', true); });
  });

  function resolve(code) {
    var directItem = allItems.find(function (it) { return it.SerialNumber === code || it.ItemID === code; });
    if (directItem) { showUpdateChoice(directItem); return; }
    var model = models.find(function (m) { return m.Barcode === code || m.ModelID === code; });
    if (model) { showModelChoice(model, code); return; }
    resolver.innerHTML = '<div class="empty-state"><strong>No match</strong>"' + code + '" isn\'t linked to any model or item yet. Add the model under <em>Models</em> first, or pick one manually below.</div>' +
      '<div class="field-row" style="margin-top:10px;"><select id="bulk-manual-model">' + models.map(function (m) { return '<option value="' + m.ModelID + '">' + m.ModelName + '</option>'; }).join('') + '</select>' +
      '<button class="btn btn-secondary btn-sm" id="bulk-manual-add">Use this model</button></div>';
    var sel = resolver.querySelector('#bulk-manual-model');
    resolver.querySelector('#bulk-manual-add').addEventListener('click', function () {
      var m = models.find(function (x) { return x.ModelID === sel.value; });
      if (m) showModelChoice(m, code);
    });
  }

  function showModelChoice(model, code) {
    resolver.innerHTML =
      '<p><strong class="mono">' + code + '</strong> matches model <strong>' + model.ModelName + '</strong>. What do you want to do?</p>' +
      '<div class="row-actions" style="margin-bottom:12px;">' +
      '<button class="btn btn-primary btn-sm" id="choice-add">Add new stock</button>' +
      '<button class="btn btn-secondary btn-sm" id="choice-update">Update an existing item</button>' +
      '</div><div id="choice-body"></div>';
    resolver.querySelector('#choice-add').addEventListener('click', function () { renderAddForm(model); });
    resolver.querySelector('#choice-update').addEventListener('click', function () { renderModelItemPicker(model); });
  }

  function renderAddForm(model) {
    var body = resolver.querySelector('#choice-body');
    var f = buildForm([
      { name: 'Quantity', label: 'Quantity', type: 'number', required: true },
      { name: 'SerialPrefix', label: 'Serial prefix (optional)' },
      { name: 'Location', label: 'Location', required: true }
    ], { Quantity: 1, Location: 'Main Warehouse' });
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-primary btn-sm'; btn.textContent = 'Queue this stock line';
    f.form.appendChild(btn);
    btn.addEventListener('click', function () {
      var v = f.getValues();
      receiveQueue.push({ ModelID: model.ModelID, ModelName: model.ModelName, Quantity: v.Quantity, SerialPrefix: v.SerialPrefix, Location: v.Location });
      drawReceiveQueue();
      resolver.innerHTML = ''; scanInput.focus();
    });
    body.innerHTML = ''; body.appendChild(f.form);
  }

  function renderModelItemPicker(model) {
    var body = resolver.querySelector('#choice-body');
    var candidates = allItems.filter(function (it) { return it.ModelID === model.ModelID; });
    if (!candidates.length) { body.innerHTML = '<p style="color:var(--ink-muted);font-size:13px;">No existing items recorded for this model yet.</p>'; return; }
    var select = document.createElement('select');
    candidates.forEach(function (it) { var o = document.createElement('option'); o.value = it.ItemID; o.textContent = it.SerialNumber + ' — ' + it.Status; select.appendChild(o); });
    body.innerHTML = '';
    body.appendChild(select);
    var goBtn = document.createElement('button'); goBtn.className = 'btn btn-secondary btn-sm'; goBtn.style.marginLeft = '8px'; goBtn.textContent = 'Choose';
    body.appendChild(goBtn);
    goBtn.addEventListener('click', function () {
      var item = candidates.find(function (it) { return it.ItemID === select.value; });
      showUpdateChoice(item);
    });
  }

  function showUpdateChoice(item) {
    resolver.innerHTML = '<p>Update <strong class="mono">' + item.SerialNumber + '</strong> — currently ' + statusBadge(item.Status) + ' · ' + item.Condition + '</p><div id="choice-body"></div>';
    var body = resolver.querySelector('#choice-body');
    var f = buildForm([
      { name: 'NewStatus', label: 'New status', type: 'select', options: STATUS_OPTIONS.map(function (s) { return { value: s, label: s }; }) },
      { name: 'NewCondition', label: 'New condition', type: 'select', options: CONDITION_OPTIONS.map(function (c) { return { value: c, label: c }; }) },
      { name: 'ToLocation', label: 'Location' },
      { name: 'Remarks', label: 'Remarks', type: 'textarea' }
    ], { NewStatus: item.Status, NewCondition: item.Condition, ToLocation: item.Location });
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-primary btn-sm'; btn.textContent = 'Queue this update';
    f.form.appendChild(btn);
    btn.addEventListener('click', function () {
      var v = f.getValues();
      moveQueue.push({ ItemID: item.ItemID, SerialNumber: item.SerialNumber, NewStatus: v.NewStatus, NewCondition: v.NewCondition, ToLocation: v.ToLocation, Remarks: v.Remarks });
      drawMoveQueue();
      resolver.innerHTML = ''; scanInput.focus();
    });
    body.appendChild(f.form);
  }

  function drawReceiveQueue() {
    renderTable(document.getElementById('bulk-receive-table'), [
      { key: 'ModelName', label: 'Model' },
      { key: 'Quantity', label: 'Qty' },
      { key: 'Location', label: 'Location' }
    ], receiveQueue, {
      actions: [{ label: 'Remove', cls: 'btn-danger', onClick: function (row) { receiveQueue.splice(receiveQueue.indexOf(row), 1); drawReceiveQueue(); } }]
    });
  }
  function drawMoveQueue() {
    renderTable(document.getElementById('bulk-move-table'), [
      { key: 'SerialNumber', label: 'Serial', mono: true },
      { key: 'NewStatus', label: 'New status', render: function (r) { return statusBadge(r.NewStatus); } },
      { key: 'ToLocation', label: 'Location' }
    ], moveQueue, {
      actions: [{ label: 'Remove', cls: 'btn-danger', onClick: function (row) { moveQueue.splice(moveQueue.indexOf(row), 1); drawMoveQueue(); } }]
    });
  }
  drawReceiveQueue(); drawMoveQueue();

  document.getElementById('bulk-submit').addEventListener('click', function () {
    if (!receiveQueue.length && !moveQueue.length) { toast('Nothing queued yet', true); return; }
    var jobs = [];
    if (receiveQueue.length) jobs.push(api.bulkReceiveStock({ User: USER.Username, Lines: receiveQueue }));
    if (moveQueue.length) jobs.push(api.bulkMoveItems({ User: USER.Username, Updates: moveQueue }));
    withLoading(Promise.all(jobs)).then(function () {
      toast('Batch processed: ' + receiveQueue.length + ' stock line(s), ' + moveQueue.length + ' update(s)');
      navigate('bulk');
    }).catch(function (e) { toast(e.message, true); });
  });
}

// ---------------- Deliveries ----------------
function viewDeliveries() {
  head('Deliveries', 'Send items out for delivery or installation at a client site.', 'New delivery', openForm);
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);
  var deliveries = [], clients = [];
  refresh();

  function refresh() {
    withLoading(Promise.all([api.list('Deliveries'), api.list('Clients')])).then(function (res) {
      deliveries = res[0]; clients = res[1]; draw();
    }).catch(function (e) { toast(e.message, true); });
  }

  function draw() {
    renderTable(tableHost, [
      { key: 'DeliveryID', label: 'Delivery #', mono: true },
      { key: 'Date', label: 'Date', render: function (r) { return fmtDate(r.Date); } },
      { label: 'Client', render: function (r) { var c = clients.find(function (x) { return x.ClientID === r.ClientID; }); return c ? c.Name : r.ClientID; } },
      { key: 'AssignedTo', label: 'Assigned to' },
      { label: 'Status', render: function (r) { return statusBadge(r.Status); } },
      { key: 'Remarks', label: 'Remarks' }
    ], deliveries);
  }

  function openForm() {
    withLoading(api.list('Items')).then(function (items) {
      var available = items.filter(function (i) { return i.Status === 'Available'; });
      var wrap = document.createElement('form');
      var f = buildForm([
        { name: 'ClientID', label: 'Client', type: 'select', options: clients.map(function (c) { return { value: c.ClientID, label: c.Name }; }), required: true },
        { name: 'AssignedTo', label: 'Assigned to (staff)' },
        { name: 'Vehicle', label: 'Vehicle (optional)' },
        { name: 'Remarks', label: 'Remarks', type: 'textarea' }
      ]);
      wrap.appendChild(f.form.firstChild ? null : null);
      while (f.form.firstChild) wrap.appendChild(f.form.firstChild);

      var scanField = document.createElement('div'); scanField.className = 'field';
      scanField.innerHTML = '<label>Scan to select</label><input type="text" placeholder="Scan a serial number to check it off">';
      wrap.appendChild(scanField);

      var pickerLabel = document.createElement('label'); pickerLabel.textContent = 'Items to deliver'; pickerLabel.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--ink-muted);display:block;margin:4px 0 6px;';
      var picker = document.createElement('div'); picker.className = 'item-picker';
      if (!available.length) picker.innerHTML = '<p style="color:var(--ink-muted);font-size:13px;">No available items in stock.</p>';
      var checkboxBySerial = {};
      available.forEach(function (it) {
        var lbl = document.createElement('label');
        lbl.innerHTML = '<input type="checkbox" value="' + it.ItemID + '"> <span class="mono">' + it.SerialNumber + '</span> — ' + it.Status;
        picker.appendChild(lbl);
        checkboxBySerial[it.SerialNumber] = lbl.querySelector('input');
      });
      wrap.appendChild(pickerLabel); wrap.appendChild(picker);

      var scanInput = scanField.querySelector('input');
      scanInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !scanInput.value.trim()) return;
        var code = scanInput.value.trim();
        var cb = checkboxBySerial[code] || (available.find(function (it) { return it.Barcode === code; }) && checkboxBySerial[(available.find(function (it) { return it.Barcode === code; })).SerialNumber]);
        if (cb) { cb.checked = true; toast('Checked off ' + code); } else { toast('No available item matches "' + code + '"', true); }
        scanInput.value = '';
      });

      var submit = document.createElement('div'); submit.className = 'form-actions';
      submit.innerHTML = '<button type="button" class="btn btn-secondary" id="cancel">Cancel</button><button class="btn btn-primary">Create delivery</button>';
      wrap.appendChild(submit);
      submit.querySelector('#cancel').addEventListener('click', closeModal);
      wrap.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = f.getValues();
        v.Items = Array.from(picker.querySelectorAll('input:checked')).map(function (c) { return c.value; });
        v.User = USER.Username;
        if (!v.Items.length) { toast('Select at least one item', true); return; }
        withLoading(api.createDelivery(v)).then(function () { closeModal(); toast('Delivery created'); refresh(); }).catch(function (e) { toast(e.message, true); });
      });
      openModal('New delivery', wrap);
    });
  }
}

// ---------------- Installations ----------------
function viewInstallations() {
  head('Installations', 'Confirm items installed at the client site.', 'New installation', openForm);
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);
  var installations = [], clients = [];
  refresh();

  function refresh() {
    withLoading(Promise.all([api.list('Installations'), api.list('Clients')])).then(function (res) {
      installations = res[0]; clients = res[1]; draw();
    }).catch(function (e) { toast(e.message, true); });
  }

  function draw() {
    renderTable(tableHost, [
      { key: 'InstallationID', label: 'Installation #', mono: true },
      { label: 'Client', render: function (r) { var c = clients.find(function (x) { return x.ClientID === r.ClientID; }); return c ? c.Name : r.ClientID; } },
      { key: 'Technician', label: 'Technician' },
      { key: 'InstallationDate', label: 'Date', render: function (r) { return fmtDate(r.InstallationDate); } },
      { label: 'Status', render: function (r) { return statusBadge(r.Status); } },
      { key: 'Remarks', label: 'Remarks' }
    ], installations);
  }

  function openForm() {
    withLoading(api.list('Items')).then(function (items) {
      var pending = items.filter(function (i) { return i.Status === 'Out for Delivery' || i.Status === 'Delivered' || i.Status === 'For Installation'; });
      var wrap = document.createElement('form');
      var f = buildForm([
        { name: 'ClientID', label: 'Client', type: 'select', options: clients.map(function (c) { return { value: c.ClientID, label: c.Name }; }), required: true },
        { name: 'Technician', label: 'Technician' },
        { name: 'Remarks', label: 'Remarks', type: 'textarea' }
      ]);
      while (f.form.firstChild) wrap.appendChild(f.form.firstChild);

      var scanField = document.createElement('div'); scanField.className = 'field';
      scanField.innerHTML = '<label>Scan to select</label><input type="text" placeholder="Scan a serial number to check it off">';
      wrap.appendChild(scanField);

      var pickerLabel = document.createElement('label'); pickerLabel.textContent = 'Items to install'; pickerLabel.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--ink-muted);display:block;margin:4px 0 6px;';
      var picker = document.createElement('div'); picker.className = 'item-picker';
      if (!pending.length) picker.innerHTML = '<p style="color:var(--ink-muted);font-size:13px;">No items awaiting installation.</p>';
      var checkboxBySerial = {};
      pending.forEach(function (it) {
        var lbl = document.createElement('label');
        lbl.innerHTML = '<input type="checkbox" value="' + it.ItemID + '"> <span class="mono">' + it.SerialNumber + '</span> — ' + it.Status;
        picker.appendChild(lbl);
        checkboxBySerial[it.SerialNumber] = lbl.querySelector('input');
      });
      wrap.appendChild(pickerLabel); wrap.appendChild(picker);

      var scanInput = scanField.querySelector('input');
      scanInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !scanInput.value.trim()) return;
        var code = scanInput.value.trim();
        var cb = checkboxBySerial[code] || (pending.find(function (it) { return it.Barcode === code; }) && checkboxBySerial[(pending.find(function (it) { return it.Barcode === code; })).SerialNumber]);
        if (cb) { cb.checked = true; toast('Checked off ' + code); } else { toast('No pending item matches "' + code + '"', true); }
        scanInput.value = '';
      });

      var submit = document.createElement('div'); submit.className = 'form-actions';
      submit.innerHTML = '<button type="button" class="btn btn-secondary" id="cancel">Cancel</button><button class="btn btn-primary">Create installation</button>';
      wrap.appendChild(submit);
      submit.querySelector('#cancel').addEventListener('click', closeModal);
      wrap.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = f.getValues();
        v.Items = Array.from(picker.querySelectorAll('input:checked')).map(function (c) { return { ItemID: c.value, Condition: 'Good' }; });
        v.User = USER.Username;
        if (!v.Items.length) { toast('Select at least one item', true); return; }
        withLoading(api.createInstallation(v)).then(function () { closeModal(); toast('Installation recorded'); refresh(); }).catch(function (e) { toast(e.message, true); });
      });
      openModal('New installation', wrap);
    });
  }
}

// ---------------- Generic master data (Clients / Suppliers) ----------------
function clientFields() {
  return [
    { name: 'Name', label: 'Client name', required: true },
    { name: 'ContactPerson', label: 'Contact person' },
    { name: 'ContactNumber', label: 'Contact number' },
    { name: 'Email', label: 'Email' },
    { name: 'Address', label: 'Address', type: 'textarea' },
    { name: 'Remarks', label: 'Remarks', type: 'textarea' },
    { name: 'Active', label: 'Active', type: 'checkbox' }
  ];
}
function supplierFields() {
  return [
    { name: 'Name', label: 'Supplier name', required: true },
    { name: 'ContactPerson', label: 'Contact person' },
    { name: 'ContactNumber', label: 'Contact number' },
    { name: 'Email', label: 'Email' },
    { name: 'Address', label: 'Address', type: 'textarea' },
    { name: 'Remarks', label: 'Remarks', type: 'textarea' },
    { name: 'Active', label: 'Active', type: 'checkbox' }
  ];
}

function viewMasterData(entity, idField, fields) {
  head(entity, entity === 'Clients' ? 'Everyone you deliver to and install for.' : 'Everyone you receive stock from.', 'Add ' + entity.slice(0, -1).toLowerCase(), function () { openForm(); });
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);
  var rows = [];
  withLoading(api.list(entity)).then(function (r) { rows = r; draw(); }).catch(function (e) { toast(e.message, true); });

  function draw() {
    renderTable(tableHost, [
      { key: idField, label: 'ID', mono: true },
      { key: 'Name', label: 'Name' },
      { key: 'ContactPerson', label: 'Contact' },
      { key: 'ContactNumber', label: 'Phone' },
      { key: 'Email', label: 'Email' },
      { label: 'Active', render: function (r) { return r.Active ? 'Yes' : 'No'; } }
    ], rows, {
      actions: [
        { label: 'Edit', onClick: openForm },
        { label: 'Delete', cls: 'btn-danger', onClick: function (r) {
          if (!confirm('Delete ' + r.Name + '?')) return;
          withLoading(api.remove(entity, r[idField])).then(function () { toast('Deleted'); navigate(entity.toLowerCase()); }).catch(function (e) { toast(e.message, true); });
        } }
      ]
    });
  }

  function openForm(existing) {
    var f = buildForm(fields, existing || { Active: true });
    var submit = document.createElement('div'); submit.className = 'form-actions';
    submit.innerHTML = '<button type="button" class="btn btn-secondary" id="cancel">Cancel</button><button class="btn btn-primary">' + (existing ? 'Save changes' : 'Add') + '</button>';
    f.form.appendChild(submit);
    submit.querySelector('#cancel').addEventListener('click', closeModal);
    f.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = f.getValues();
      var op = existing ? api.update(entity, existing[idField], v) : api.create(entity, v);
      withLoading(op).then(function () { closeModal(); toast('Saved'); navigate(entity.toLowerCase()); }).catch(function (e) { toast(e.message, true); });
    });
    openModal(existing ? 'Edit' : 'Add', f.form);
  }
}

// ---------------- Stock Monitor (live per-model counts) ----------------
function viewStockMonitor() {
  head('Stock Monitor', 'Filter by model to see how many are left and where every unit stands.');

  var filterBar = document.createElement('div'); filterBar.className = 'filter-bar';
  filterBar.innerHTML =
    '<input type="text" id="sm-model-input" list="sm-models" placeholder="Type or pick a model — e.g. A100">' +
    '<datalist id="sm-models"></datalist>' +
    '<button class="btn btn-secondary btn-sm" id="sm-refresh">Refresh</button>';
  root.appendChild(filterBar);

  var host = document.createElement('div'); root.appendChild(host);
  host.innerHTML = '<div class="empty-state"><strong>Pick a model</strong>Choose a model above to see live stock counts and movement.</div>';

  var models = [], items = [], movements = [];
  load();

  filterBar.querySelector('#sm-refresh').addEventListener('click', load);
  var input = filterBar.querySelector('#sm-model-input');
  input.addEventListener('input', function () { draw(input.value.trim()); });

  function load() {
    withLoading(Promise.all([api.list('Models'), api.list('Items'), api.list('StockMovements')])).then(function (res) {
      models = res[0]; items = res[1]; movements = res[2];
      var datalist = filterBar.querySelector('#sm-models');
      datalist.innerHTML = models.map(function (m) { return '<option value="' + m.ModelName + '">'; }).join('');
      if (input.value.trim()) draw(input.value.trim());
    }).catch(function (e) { toast(e.message, true); });
  }

  function draw(query) {
    var model = models.find(function (m) {
      return m.ModelName.toLowerCase() === query.toLowerCase() || m.ModelID.toLowerCase() === query.toLowerCase() || m.Barcode === query;
    });
    if (!model) {
      host.innerHTML = query
        ? '<div class="empty-state"><strong>No exact match</strong>Keep typing, or pick a suggestion from the list.</div>'
        : '<div class="empty-state"><strong>Pick a model</strong>Choose a model above to see live stock counts and movement.</div>';
      return;
    }

    var modelItems = items.filter(function (it) { return it.ModelID === model.ModelID; });
    var counts = {};
    modelItems.forEach(function (it) { counts[it.Status] = (counts[it.Status] || 0) + 1; });
    var available = counts['Available'] || 0;
    var minStock = Number(model.MinStock || 0);
    var lowStock = available <= minStock;

    var itemIds = {};
    modelItems.forEach(function (it) { itemIds[it.ItemID] = true; });
    var modelMoves = movements.filter(function (m) { return itemIds[m.ItemID]; })
      .sort(function (a, b) { return new Date(b.DateTime) - new Date(a.DateTime); }).slice(0, 25);

    host.innerHTML = '';

    var infoPanel = document.createElement('div'); infoPanel.className = 'panel';
    infoPanel.innerHTML =
      '<h2>' + model.ModelName + '</h2>' +
      '<p style="color:var(--ink-muted);font-size:13.5px;margin-bottom:14px;">' +
      (model.Brand ? model.Brand + ' · ' : '') + (model.Category || '') + ' · Barcode: <span class="mono">' + model.Barcode + '</span> · Min stock: ' + minStock +
      '</p>' +
      (lowStock ? '<div class="loading-banner" style="background:var(--rust);color:#fff;">Low stock — only ' + available + ' available, at or below the minimum of ' + minStock + '</div>' : '');
    host.appendChild(infoPanel);

    var order = ['Available', 'Reserved', 'Out for Delivery', 'Delivered', 'For Installation', 'Installed', 'Returned', 'For Repair', 'Damaged', 'Lost', 'Disposed'];
    var grid = document.createElement('div'); grid.className = 'stat-grid';
    var cards = [{ n: modelItems.length, l: 'Total units' }];
    order.forEach(function (s) { if (counts[s]) cards.push({ n: counts[s], l: s }); });
    grid.innerHTML = cards.map(function (c) {
      return '<div class="stat-card"><div class="n">' + c.n + '</div><div class="l">' + c.l + '</div></div>';
    }).join('');
    host.appendChild(grid);

    var panelsWrap = document.createElement('div'); panelsWrap.style.display = 'grid'; panelsWrap.style.gridTemplateColumns = '1fr 1fr'; panelsWrap.style.gap = '20px';
    var itemsPanel = document.createElement('div'); itemsPanel.className = 'panel'; itemsPanel.innerHTML = '<h2>Units</h2><div id="sm-items"></div>';
    var movesPanel = document.createElement('div'); movesPanel.className = 'panel'; movesPanel.innerHTML = '<h2>Recent movement</h2><div id="sm-moves"></div>';
    panelsWrap.appendChild(itemsPanel); panelsWrap.appendChild(movesPanel);
    host.appendChild(panelsWrap);

    renderTable(itemsPanel.querySelector('#sm-items'), [
      { key: 'SerialNumber', label: 'Serial', mono: true },
      { label: 'Status', render: function (r) { return statusBadge(r.Status); } },
      { key: 'Condition', label: 'Condition' },
      { key: 'Location', label: 'Location' }
    ], modelItems);

    renderTable(movesPanel.querySelector('#sm-moves'), [
      { key: 'SerialNumber', label: 'Serial', mono: true },
      { label: 'Change', render: function (r) { return statusBadge(r.PrevStatus || '—') + ' → ' + statusBadge(r.NewStatus); } },
      { key: 'DateTime', label: 'When', render: function (r) { return fmtDate(r.DateTime); } }
    ], modelMoves);
  }
}

// ---------------- Reports ----------------
function viewReports() {
  head('Reports', 'Pull a filtered view for inventory, movements, deliveries, or installations.');
  var tabs = document.createElement('div'); tabs.className = 'filter-bar';
  ['Inventory', 'Movements', 'Deliveries', 'Installations', 'Serial history'].forEach(function (name, i) {
    var b = document.createElement('button'); b.className = 'btn btn-sm ' + (i === 0 ? 'btn-primary' : 'btn-secondary'); b.textContent = name; b.dataset.tab = name;
    b.addEventListener('click', function () {
      tabs.querySelectorAll('button').forEach(function (x) { x.className = 'btn btn-sm btn-secondary'; });
      b.className = 'btn btn-sm btn-primary';
      loadTab(name);
    });
    tabs.appendChild(b);
  });
  root.appendChild(tabs);
  var host = document.createElement('div'); root.appendChild(host);
  loadTab('Inventory');

  function loadTab(name) {
    host.innerHTML = '';
    if (name === 'Serial history') {
      host.innerHTML = '<div class="filter-bar"><input type="text" id="r-serial" placeholder="Enter a serial number"><button class="btn btn-primary btn-sm" id="r-go">Look up</button></div><div id="r-body"></div>';
      host.querySelector('#r-go').addEventListener('click', function () {
        var s = host.querySelector('#r-serial').value.trim();
        if (!s) return;
        withLoading(api.serialHistory(s)).then(function (rows) {
          renderTable(host.querySelector('#r-body'), [
            { key: 'DateTime', label: 'When', render: function (r) { return fmtDate(r.DateTime); } },
            { label: 'Change', render: function (r) { return statusBadge(r.PrevStatus || '—') + ' → ' + statusBadge(r.NewStatus); } },
            { label: 'Location', render: function (r) { return (r.FromLocation || '—') + ' → ' + r.ToLocation; } },
            { key: 'RefNo', label: 'Reference', mono: true }
          ], rows);
        });
      });
      return;
    }
    var entityMap = { Inventory: 'Items', Movements: 'StockMovements', Deliveries: 'Deliveries', Installations: 'Installations' };
    withLoading(api.list(entityMap[name])).then(function (rows) {
      var cols = Object.keys(rows[0] || {}).filter(function (k) { return k !== '_row'; }).map(function (k) { return { key: k, label: k }; });
      renderTable(host, cols, rows);
    }).catch(function (e) { toast(e.message, true); });
  }
}

// ---------------- Users ----------------
function viewUsers() {
  head('Users', 'Administrator, Inventory Staff, and Technician roles.', 'Add user', function () { openForm(); });
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);
  var rows = [];
  withLoading(api.list('Users')).then(function (r) { rows = r; draw(); }).catch(function (e) { toast(e.message, true); });

  function draw() {
    renderTable(tableHost, [
      { key: 'UserID', label: 'User ID', mono: true },
      { key: 'Name', label: 'Name' },
      { key: 'Username', label: 'Username' },
      { key: 'Role', label: 'Role' },
      { label: 'Active', render: function (r) { return r.Active ? 'Yes' : 'No'; } }
    ], rows, {
      actions: [
        { label: 'Edit', onClick: openForm },
        { label: 'Delete', cls: 'btn-danger', onClick: function (r) {
          if (!confirm('Remove user ' + r.Username + '?')) return;
          withLoading(api.remove('Users', r.UserID)).then(function () { toast('User removed'); navigate('users'); }).catch(function (e) { toast(e.message, true); });
        } }
      ]
    });
  }

  function openForm(existing) {
    var fields = [
      { name: 'Name', label: 'Full name', required: true },
      { name: 'Username', label: 'Username', required: true },
      { name: 'Password', label: existing ? 'New password (leave blank to keep current)' : 'Password', type: 'password' },
      { name: 'Role', label: 'Role', type: 'select', options: [
        { value: 'Administrator', label: 'Administrator' }, { value: 'Inventory Staff', label: 'Inventory Staff' }, { value: 'Technician', label: 'Technician' }
      ] },
      { name: 'Active', label: 'Active', type: 'checkbox' }
    ];
    var f = buildForm(fields, existing || { Active: true, Role: 'Inventory Staff' });
    var submit = document.createElement('div'); submit.className = 'form-actions';
    submit.innerHTML = '<button type="button" class="btn btn-secondary" id="cancel">Cancel</button><button class="btn btn-primary">' + (existing ? 'Save changes' : 'Add user') + '</button>';
    f.form.appendChild(submit);
    submit.querySelector('#cancel').addEventListener('click', closeModal);
    f.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = f.getValues();
      var passwordPromise = v.Password ? hashPassword(v.Password) : Promise.resolve(null);
      passwordPromise.then(function (hash) {
        if (hash) v.PasswordHash = hash;
        delete v.Password;
        var op = existing ? api.update('Users', existing.UserID, v) : api.create('Users', Object.assign(v, { CreatedAt: new Date().toISOString() }));
        return withLoading(op);
      }).then(function () { closeModal(); toast('Saved'); navigate('users'); }).catch(function (e) { toast(e.message, true); });
    });
    openModal(existing ? 'Edit user' : 'Add user', f.form);
  }
}

// ---------------- Settings ----------------
function viewSettings() {
  head('Settings', 'System-wide configuration. Administrators only.');
  var panel = document.createElement('div'); panel.className = 'panel'; root.appendChild(panel);
  withLoading(api.list('Settings')).then(function (rows) {
    var form = document.createElement('form');
    rows.forEach(function (row) {
      var wrap = document.createElement('div'); wrap.className = 'field';
      wrap.innerHTML = '<label>' + row.Key + '</label>';
      var input = document.createElement('input'); input.value = row.Value; input.dataset.key = row.Key;
      wrap.appendChild(input);
      form.appendChild(wrap);
    });
    var submit = document.createElement('div'); submit.className = 'form-actions';
    submit.innerHTML = '<button class="btn btn-primary">Save settings</button>';
    form.appendChild(submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var updates = Array.from(form.querySelectorAll('input')).map(function (input) {
        return api.update('Settings', input.dataset.key, { Value: input.value });
      });
      withLoading(Promise.all(updates)).then(function () { toast('Settings saved'); }).catch(function (e) { toast(e.message, true); });
    });
    panel.appendChild(form);
  }).catch(function (e) { toast(e.message, true); });
}

// ---------------- Audit log ----------------
function viewAudit() {
  head('Audit Log', 'Every create, update, delete, and sign-in, timestamped.');
  var tableHost = document.createElement('div'); root.appendChild(tableHost);
  renderSkeleton(tableHost);
  withLoading(api.list('AuditLogs')).then(function (rows) {
    rows.sort(function (a, b) { return new Date(b.DateTime) - new Date(a.DateTime); });
    renderTable(tableHost, [
      { key: 'DateTime', label: 'When', render: function (r) { return fmtDate(r.DateTime); } },
      { key: 'User', label: 'User' },
      { key: 'Action', label: 'Action' },
      { key: 'Details', label: 'Details' }
    ], rows);
  }).catch(function (e) { toast(e.message, true); });
}

})();

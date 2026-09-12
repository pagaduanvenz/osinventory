/**
 * OneSecai Inventory System — Apps Script API
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone with the link
 * Copy the deployment URL into script.js -> CONFIG.API_URL
 *
 * Sheet tabs required (create once, headers in row 1):
 *   Users, Settings, Models, Items, Suppliers, Clients,
 *   StockMovements, Deliveries, DeliveryItems,
 *   Installations, InstallationItems, AuditLogs
 * Run setupSheets() once from the Apps Script editor to create everything.
 */

var SHEETS = {
  Users: ['UserID','Name','Username','PasswordHash','Role','Active','CreatedAt'],
  Settings: ['Key','Value'],
  Models: ['ModelID','ModelName','Category','Brand','Barcode','Unit','MinStock','Description','Active'],
  Items: ['ItemID','ModelID','SerialNumber','Barcode','Status','Condition','Location','ClientID','CreatedAt','UpdatedAt'],
  Suppliers: ['SupplierID','Name','ContactPerson','ContactNumber','Email','Address','Remarks','Active'],
  Clients: ['ClientID','Name','ContactPerson','ContactNumber','Email','Address','Remarks','Active'],
  StockMovements: ['MovementID','DateTime','ItemID','SerialNumber','PrevStatus','NewStatus','FromLocation','ToLocation','ClientID','RefNo','Remarks','User'],
  Deliveries: ['DeliveryID','Date','ClientID','AssignedTo','Vehicle','Status','Remarks','CreatedBy'],
  DeliveryItems: ['DeliveryID','ItemID','SerialNumber'],
  Installations: ['InstallationID','DeliveryID','ClientID','Technician','InstallationDate','Status','Remarks'],
  InstallationItems: ['InstallationID','ItemID','SerialNumber','Condition'],
  AuditLogs: ['LogID','DateTime','User','Action','Details']
};

var ID_PREFIX = {
  Models: 'MOD-', Items: 'ITM-', Suppliers: 'SUP-', Clients: 'CLI-',
  StockMovements: 'MOV-', Deliveries: 'DEL-', Installations: 'INS-',
  Users: 'USR-', AuditLogs: 'LOG-'
};

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function setupSheets() {
  var book = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var sheet = book.getSheetByName(name) || book.insertSheet(name);
    sheet.clear();
    sheet.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
    sheet.setFrozenRows(1);
  });
  var users = book.getSheetByName('Users');
  users.appendRow(['USR-00001', 'Administrator', 'admin', hash_('admin123'), 'Administrator', true, new Date()]);
  var settings = book.getSheetByName('Settings');
  var defaults = [
    ['CompanyName', 'OneSecai'], ['ItemIDPrefix', 'ITM-'], ['DeliveryIDPrefix', 'DEL-'],
    ['InstallationIDPrefix', 'INS-'], ['LowStockThreshold', '5'], ['DefaultLocation', 'Main Warehouse']
  ];
  settings.getRange(2, 1, defaults.length, 2).setValues(defaults);
  SpreadsheetApp.flush();
}

function hash_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return digest.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

function sheet_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Unknown sheet: ' + name);
  return sheet;
}

function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function readAll_(name) {
  var sheet = sheet_(name);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var headers = headers_(sheet);
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row, idx) {
    var obj = { _row: idx + 2 };
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findRow_(name, idField, idValue) {
  var sheet = sheet_(name);
  var headers = headers_(sheet);
  var idCol = headers.indexOf(idField);
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idCol]) === String(idValue)) return { rowIndex: i + 2, headers: headers, values: values[i] };
  }
  return null;
}

function nextId_(name) {
  var rows = readAll_(name);
  var prefix = ID_PREFIX[name] || 'ID-';
  var max = 0;
  rows.forEach(function (r) {
    var idField = SHEETS[name][0];
    var num = parseInt(String(r[idField]).replace(prefix, ''), 10);
    if (!isNaN(num) && num > max) max = num;
  });
  var next = max + 1;
  return prefix + String(next).padStart(5, '0');
}

function appendRow_(name, record) {
  var sheet = sheet_(name);
  var headers = headers_(sheet);
  var row = headers.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; });
  sheet.appendRow(row);
  return record;
}

function updateRow_(name, idField, idValue, patch) {
  var found = findRow_(name, idField, idValue);
  if (!found) throw new Error('Record not found: ' + idValue);
  var sheet = sheet_(name);
  var headers = found.headers;
  var newValues = headers.map(function (h, i) {
    return patch.hasOwnProperty(h) ? patch[h] : found.values[i];
  });
  sheet.getRange(found.rowIndex, 1, 1, headers.length).setValues([newValues]);
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = newValues[i]; });
  return obj;
}

function deleteRow_(name, idField, idValue) {
  var found = findRow_(name, idField, idValue);
  if (!found) throw new Error('Record not found: ' + idValue);
  sheet_(name).deleteRow(found.rowIndex);
  return { deleted: idValue };
}

function log_(user, action, details) {
  appendRow_('AuditLogs', {
    LogID: nextId_('AuditLogs'), DateTime: new Date(), User: user || 'system',
    Action: action, Details: typeof details === 'string' ? details : JSON.stringify(details)
  });
}

// ---------- Business actions ----------

function login_(username, password) {
  var users = readAll_('Users');
  var user = users.find(function (u) { return u.Username === username && u.Active; });
  if (!user || user.PasswordHash !== hash_(password)) return { ok: false, error: 'Invalid username or password' };
  log_(username, 'LOGIN', 'User logged in');
  return { ok: true, user: { UserID: user.UserID, Name: user.Name, Username: user.Username, Role: user.Role } };
}

function receiveStock_(p) {
  // p: { ModelID, Quantity, SerialPrefix, Location, User, Remarks }
  var model = findRow_('Models', 'ModelID', p.ModelID);
  if (!model) throw new Error('Model not found');
  var barcodeIdx = model.headers.indexOf('Barcode');
  var barcode = model.values[barcodeIdx];
  var created = [];
  for (var i = 0; i < Number(p.Quantity); i++) {
    var itemId = nextId_('Items');
    var serial = (p.SerialPrefix || p.ModelID) + '-' + Utilities.getUuid().slice(0, 6).toUpperCase();
    var record = {
      ItemID: itemId, ModelID: p.ModelID, SerialNumber: serial, Barcode: barcode,
      Status: 'Available', Condition: 'New', Location: p.Location || 'Main Warehouse',
      ClientID: '', CreatedAt: new Date(), UpdatedAt: new Date()
    };
    appendRow_('Items', record);
    appendRow_('StockMovements', {
      MovementID: nextId_('StockMovements'), DateTime: new Date(), ItemID: itemId, SerialNumber: serial,
      PrevStatus: '', NewStatus: 'Available', FromLocation: '', ToLocation: record.Location,
      ClientID: '', RefNo: '', Remarks: p.Remarks || 'Stock received', User: p.User || 'system'
    });
    created.push(record);
  }
  log_(p.User, 'RECEIVE_STOCK', { ModelID: p.ModelID, Quantity: p.Quantity });
  return created;
}

function moveItem_(p) {
  // p: { ItemID, NewStatus, NewCondition, ToLocation, ClientID, RefNo, Remarks, User }
  var found = findRow_('Items', 'ItemID', p.ItemID);
  if (!found) throw new Error('Item not found');
  var headers = found.headers;
  var prevStatus = found.values[headers.indexOf('Status')];
  var prevLocation = found.values[headers.indexOf('Location')];
  var serial = found.values[headers.indexOf('SerialNumber')];
  var patch = { UpdatedAt: new Date() };
  if (p.NewStatus) patch.Status = p.NewStatus;
  if (p.NewCondition) patch.Condition = p.NewCondition;
  if (p.ToLocation) patch.Location = p.ToLocation;
  if (p.ClientID !== undefined) patch.ClientID = p.ClientID;
  var updated = updateRow_('Items', 'ItemID', p.ItemID, patch);
  appendRow_('StockMovements', {
    MovementID: nextId_('StockMovements'), DateTime: new Date(), ItemID: p.ItemID, SerialNumber: serial,
    PrevStatus: prevStatus, NewStatus: patch.Status || prevStatus, FromLocation: prevLocation,
    ToLocation: patch.Location || prevLocation, ClientID: p.ClientID || '', RefNo: p.RefNo || '',
    Remarks: p.Remarks || '', User: p.User || 'system'
  });
  log_(p.User, 'MOVE_ITEM', { ItemID: p.ItemID, NewStatus: p.NewStatus });
  return updated;
}

function createDelivery_(p) {
  // p: { ClientID, AssignedTo, Vehicle, Remarks, User, Items: [ItemID,...] }
  var deliveryId = nextId_('Deliveries');
  appendRow_('Deliveries', {
    DeliveryID: deliveryId, Date: new Date(), ClientID: p.ClientID, AssignedTo: p.AssignedTo || '',
    Vehicle: p.Vehicle || '', Status: 'Out for Delivery', Remarks: p.Remarks || '', CreatedBy: p.User || 'system'
  });
  (p.Items || []).forEach(function (itemId) {
    var itemRow = findRow_('Items', 'ItemID', itemId);
    var serial = itemRow ? itemRow.values[itemRow.headers.indexOf('SerialNumber')] : '';
    appendRow_('DeliveryItems', { DeliveryID: deliveryId, ItemID: itemId, SerialNumber: serial });
    moveItem_({ ItemID: itemId, NewStatus: 'Out for Delivery', ToLocation: 'Vehicle', ClientID: p.ClientID, RefNo: deliveryId, Remarks: 'Delivery ' + deliveryId, User: p.User });
  });
  log_(p.User, 'CREATE_DELIVERY', { DeliveryID: deliveryId, ClientID: p.ClientID });
  return { DeliveryID: deliveryId };
}

function createInstallation_(p) {
  // p: { DeliveryID, ClientID, Technician, Remarks, User, Items: [{ItemID, Condition}] }
  var installId = nextId_('Installations');
  appendRow_('Installations', {
    InstallationID: installId, DeliveryID: p.DeliveryID || '', ClientID: p.ClientID, Technician: p.Technician || '',
    InstallationDate: new Date(), Status: 'Installed', Remarks: p.Remarks || ''
  });
  (p.Items || []).forEach(function (item) {
    var itemRow = findRow_('Items', 'ItemID', item.ItemID);
    var serial = itemRow ? itemRow.values[itemRow.headers.indexOf('SerialNumber')] : '';
    appendRow_('InstallationItems', { InstallationID: installId, ItemID: item.ItemID, SerialNumber: serial, Condition: item.Condition || 'Good' });
    moveItem_({ ItemID: item.ItemID, NewStatus: 'Installed', NewCondition: item.Condition || 'Good', ToLocation: 'Client Site', ClientID: p.ClientID, RefNo: installId, Remarks: 'Installation ' + installId, User: p.User });
  });
  log_(p.User, 'CREATE_INSTALLATION', { InstallationID: installId, ClientID: p.ClientID });
  return { InstallationID: installId };
}

function serialHistory_(serial) {
  var moves = readAll_('StockMovements').filter(function (m) { return m.SerialNumber === serial; });
  moves.sort(function (a, b) { return new Date(a.DateTime) - new Date(b.DateTime); });
  return moves;
}

function dashboard_() {
  var items = readAll_('Items');
  var counts = {};
  items.forEach(function (it) { counts[it.Status] = (counts[it.Status] || 0) + 1; });
  var models = readAll_('Models');
  var lowStock = models.filter(function (m) {
    var avail = items.filter(function (it) { return it.ModelID === m.ModelID && it.Status === 'Available'; }).length;
    return avail <= Number(m.MinStock || 0);
  });
  var recentMoves = readAll_('StockMovements').sort(function (a, b) { return new Date(b.DateTime) - new Date(a.DateTime); }).slice(0, 10);
  return { totalItems: items.length, statusCounts: counts, lowStock: lowStock, recentMoves: recentMoves };
}

// ---------- HTTP entry points ----------

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function doGet(e) {
  try {
    var action = e.parameter.action;
    var result;
    switch (action) {
      case 'list':
        result = readAll_(e.parameter.entity);
        break;
      case 'dashboard':
        result = dashboard_();
        break;
      case 'serialHistory':
        result = serialHistory_(e.parameter.serial);
        break;
      case 'itemLookup':
        result = readAll_('Items').filter(function (it) {
          return it.SerialNumber === e.parameter.value || it.Barcode === e.parameter.value || it.ItemID === e.parameter.value;
        });
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var result = withLock_(function () {
      switch (action) {
        case 'login': return login_(body.username, body.password);
        case 'create': return appendRow_(body.entity, Object.assign({ [SHEETS[body.entity][0]]: nextId_(body.entity) }, body.record));
        case 'update': return updateRow_(body.entity, SHEETS[body.entity][0], body.id, body.record);
        case 'delete': return deleteRow_(body.entity, SHEETS[body.entity][0], body.id);
        case 'receiveStock': return receiveStock_(body.payload);
        case 'moveItem': return moveItem_(body.payload);
        case 'createDelivery': return createDelivery_(body.payload);
        case 'createInstallation': return createInstallation_(body.payload);
        default: throw new Error('Unknown action: ' + action);
      }
    });
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

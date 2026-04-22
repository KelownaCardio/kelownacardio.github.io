// ═══════════════════════════════════════════════════════
// KGH Cardiology Billing — Google Apps Script backend
// Deploy as Web App: Execute as Me, Anyone can access
//
// SETUP INSTRUCTIONS:
// 1. In Google Sheets: Extensions → Apps Script → paste this file
// 2. Run setupTrigger() ONCE manually to schedule Sunday night emails
// 3. Deploy as Web App: Execute as Me, Anyone can access
// 4. Paste the web app URL into 01_config.js as SHEETS_URL
// ═══════════════════════════════════════════════════════

var SHARED_KEY     = 'kgh2026';
var BILLING_EMAIL  = 'kathrynb77@gmail.com';
var EMAIL_SUBJECT  = 'Weekly KGH Cardiology Claims';

// ── Web app entry points ───────────────────────────────
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  var p      = e.parameter || {};
  var action = p.action    || '';
  var key    = p.key       || '';
  var out    = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);

  if (key !== SHARED_KEY) {
    out.setContent(JSON.stringify({ error: 'unauthorized' }));
    return out;
  }

  var body = {};
  try {
    if (e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch(err) {}

  var result;
  try {
    if      (action === 'getAll')           result = getAll();
    else if (action === 'savePatient')      result = saveRow('Patients',  body, 'id');
    else if (action === 'savePatients')     result = saveAll('Patients',  body.patients || []);
    else if (action === 'deletePatient')    result = saveRow('Patients',  body, 'id');
    else if (action === 'saveClaim')        result = saveRow('Claims',    body, 'id');
    else if (action === 'deleteClaim')      result = deleteRow('Claims',  body.id);
    else if (action === 'saveRef')          result = saveRow('Referrers', body, 'id');
    else if (action === 'saveDoctor')       result = saveRow('Doctors',   body, 'alias');
    else if (action === 'logChange')        result = appendRow('ChangeLog', body);
    else if (action === 'searchPhysicians') result = searchPhysicians(p.q || '');
    else result = { error: 'unknown action: ' + action };
  } catch(err) {
    result = { error: err.toString() };
  }

  out.setContent(JSON.stringify(result));
  return out;
}

// ═══════════════════════════════════════════════════════
// WEEKLY EXPORT — runs automatically every Sunday 9pm PT
// Can also be triggered manually: run exportWeeklyClaims()
// ═══════════════════════════════════════════════════════

function exportWeeklyClaims() {
  var claims = sheetToObjects(getSheet('Claims'));
  if (!claims.length) {
    Logger.log('No claims to export.');
    return;
  }

  // Only unsubmitted claims
  var pending = claims.filter(function(c) { return !c.submitted; });
  if (!pending.length) {
    Logger.log('No unsubmitted claims this week.');
    sendNoClaimsEmail();
    return;
  }

  // Separate raw CCU taps from regular claims
  var regular = pending.filter(function(c) { return c.fee !== 'CCU_DAILY'; });
  var ccuTaps = pending.filter(function(c) { return c.fee === 'CCU_DAILY'; });

  // Consolidate CCU taps into 1411/1421/1431 bands
  var ccuRows = consolidateCCU(ccuTaps);

  var allRows = regular.concat(ccuRows);

  // Sort by date then doctor
  allRows.sort(function(a, b) {
    var da = parseDMY(a.date), db = parseDMY(b.date);
    if (da !== db) return da - db;
    return (a.alias || '').localeCompare(b.alias || '');
  });

  // Build iClinic CSV
  var csv = buildIClinicCSV(allRows);

  // Email to billing coordinator
  var dateStr    = Utilities.formatDate(new Date(), 'America/Vancouver', 'yyyy-MM-dd');
  var weekStart  = getWeekStart();
  var weekEnd    = Utilities.formatDate(new Date(), 'America/Vancouver', 'MMM d');
  var fileName   = 'KGH_Claims_' + dateStr + '.csv';
  var body       = buildEmailBody(allRows, pending.length, ccuTaps.length, weekStart, weekEnd);

  GmailApp.sendEmail(BILLING_EMAIL, EMAIL_SUBJECT + ' — ' + weekStart + ' to ' + weekEnd, body, {
    attachments: [Utilities.newBlob(csv, 'text/csv', fileName)],
    name: 'KGH Cardiology Billing'
  });

  // Mark all pending claims as submitted
  markAsSubmitted(pending);

  Logger.log('Exported ' + allRows.length + ' claims (' + pending.length + ' raw) to ' + BILLING_EMAIL);
}

// ── CCU Consolidation ──────────────────────────────────
function consolidateCCU(taps) {
  // Group by patient PHN
  var byPhn = {};
  taps.forEach(function(c) {
    var key = c.phn || (c.last + '_' + c.first);
    if (!byPhn[key]) byPhn[key] = [];
    byPhn[key].push(c);
  });

  var rows = [];
  Object.keys(byPhn).forEach(function(key) {
    var sorted = byPhn[key].slice().sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });
    var n    = sorted.length;
    var base = sorted[0];

    // Day 1: 1411 × 1
    rows.push(makeClaimRow(base, '1411', '1411', 1, sorted[0].date));

    // Days 2–7: 1421 × min(n-1, 6)
    if (n >= 2) {
      rows.push(makeClaimRow(base, '1421', '1421', Math.min(n - 1, 6), sorted[1].date));
    }

    // Days 8–30: 1431 × (n-7)
    if (n >= 8) {
      rows.push(makeClaimRow(base, '1431', '1431', n - 7, sorted[7].date));
    }
  });

  return rows;
}

function makeClaimRow(base, fee, feeCode, units, date) {
  return {
    id: base.id + '_' + fee, alias: base.alias, docnum: base.docnum,
    last: base.last, first: base.first, phn: base.phn, dob: base.dob, sex: base.sex,
    fee: fee, feeCode: feeCode, icd: base.icd, units: units, date: date,
    loc: base.loc || 'I', fac: 'OA040',
    refby: base.refby || '', refbyName: base.refbyName || '',
    notes: base.notes || '', startTime: base.startTime || ''
  };
}

// ── Build iClinic CSV ──────────────────────────────────
function buildIClinicCSV(rows) {
  var header = [
    'DOCTOR_NUMBER','PAYEE_ALIAS','PATIENT_FIRST_NAME','PATIENT_LAST_NAME','PATIENT_NAME',
    'PHN','OTHER_INSURER_CODE','GENDER','DOB','',
    'FEE_ITEM','FEE_ITEM_CODE','ICD9_CODE','AMOUNT_BILLED','SERVICE_UNITS',
    'PERCENT_BILLED','FEE_SCHEDULE','SERVICE_DATE','SERVICE_START_TIME',
    'ADDITIONAL_CLAIM_NOTES','REFERRED_BY_DOCTOR_NUMBER','REFERRED_TO_DOCTOR_NUMBER',
    'REFERRED_BY_DOCTOR_NAME','SERVICE_LOCATION_CODE','FACILITY_NUMBER',
    'SUB_FACILITY_NUMBER','SUBMISSION_CODE','CORRESPONDENCE_CODE',
    'AFTER_HOURS_INDICATOR_CODE','SCC_CODE','CLAIM_TYPE',
    'ICBC_CLAIM_NUMBER','WORK_SAFE_CLAIM_NUMBER','WORK_SAFE_INJURY_DATE',
    'WORK_SAFE_INJURY_AREA_CODE','WORK_SAFE_INJURY_NATURE_CODE','WORK_SAFE_ANATOMICAL_POSITION'
  ].join(',');

  var dataRows = rows.map(function(c) {
    // PATIENT_NAME: "Last,First" wrapped in escaped quotes for iClinic
    var pname    = '"' + (c.last || '') + ',' + (c.first || '') + '"';
    var refName  = c.refbyName ? '"' + c.refbyName + '"' : '';
    return [
      c.docnum    || '',
      c.alias     || '',
      c.first     || '',
      c.last      || '',
      pname,
      c.phn       || '',
      '',
      c.sex       || '',
      c.dob       || '',
      '',
      c.fee,
      c.feeCode   || c.fee,
      c.icd       || '3062',
      '',
      c.units     || 1,
      '100',
      'MSP',
      c.date,
      c.startTime || '',
      c.notes     || '',
      c.refby     || '',
      '',
      refName,
      c.loc       || 'I',
      'OA040',
      '',
      'P',
      '', '', '',
      'MSP',
      '', '', '', '', '', ''
    ].join(',');
  });

  return header + '\n' + dataRows.join('\n');
}

// ── Email body ─────────────────────────────────────────
function buildEmailBody(rows, rawCount, ccuTapCount, weekStart, weekEnd) {
  // Summary by doctor
  var byDoc = {};
  rows.forEach(function(c) {
    var alias = c.alias || 'Unknown';
    if (!byDoc[alias]) byDoc[alias] = 0;
    byDoc[alias]++;
  });

  var docLines = Object.keys(byDoc).sort().map(function(alias) {
    return '  ' + alias + ': ' + byDoc[alias] + ' claim' + (byDoc[alias] !== 1 ? 's' : '');
  }).join('\n');

  // Unique patient count
  var phns = {};
  rows.forEach(function(c) { if (c.phn) phns[c.phn] = true; });
  var ptCount = Object.keys(phns).length;

  return [
    'KGH Cardiology — Weekly Billing Export',
    'Period: ' + weekStart + ' to ' + weekEnd,
    '',
    'SUMMARY',
    '──────────────────────────────',
    'Total claim lines:   ' + rows.length,
    'Unique patients:     ' + ptCount,
    'Raw CCU daily taps:  ' + ccuTapCount + ' (consolidated into 1411/1421/1431)',
    '',
    'BY PHYSICIAN',
    '──────────────────────────────',
    docLines,
    '',
    'The attached CSV is ready to import directly into iClinic.',
    'File: KGH_Claims_' + Utilities.formatDate(new Date(), 'America/Vancouver', 'yyyy-MM-dd') + '.csv',
    '',
    '─ KGH Cardiology Billing System',
  ].join('\n');
}

function sendNoClaimsEmail() {
  var dateStr = Utilities.formatDate(new Date(), 'America/Vancouver', 'yyyy-MM-dd');
  GmailApp.sendEmail(BILLING_EMAIL, EMAIL_SUBJECT + ' — No new claims', [
    'KGH Cardiology — Weekly Billing Export',
    'Date: ' + dateStr,
    '',
    'No unsubmitted claims were found for this week.',
    'All previous claims have already been exported.',
    '',
    '─ KGH Cardiology Billing System',
  ].join('\n'), { name: 'KGH Cardiology Billing' });
}

// ── Mark claims as submitted ───────────────────────────
function markAsSubmitted(claims) {
  var sheet   = getSheet('Claims');
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol   = headers.indexOf('id');

  // Ensure 'submitted' and 'submittedAt' columns exist
  var subCol   = headers.indexOf('submitted');
  var subAtCol = headers.indexOf('submittedAt');
  if (subCol < 0) {
    sheet.getRange(1, headers.length + 1).setValue('submitted');
    sheet.getRange(1, headers.length + 2).setValue('submittedAt');
    subCol   = headers.length;
    subAtCol = headers.length + 1;
    // Reload data with new columns
    data    = sheet.getDataRange().getValues();
    headers = data[0];
  }

  var now      = new Date().toISOString();
  var claimIds = {};
  claims.forEach(function(c) { claimIds[c.id] = true; });

  for (var i = 1; i < data.length; i++) {
    if (claimIds[data[i][idCol]]) {
      sheet.getRange(i + 1, subCol + 1).setValue(true);
      sheet.getRange(i + 1, subAtCol + 1).setValue(now);
    }
  }
}

// ── Schedule setup ─────────────────────────────────────
// Run this function ONCE manually to create the Sunday trigger
function setupTrigger() {
  // Delete any existing weekly triggers first
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'exportWeeklyClaims') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Create new trigger: every Sunday at 9pm Pacific
  ScriptApp.newTrigger('exportWeeklyClaims')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(21)       // 9pm — Apps Script uses the script's timezone
    .nearMinute(0)
    .create();

  Logger.log('✓ Weekly trigger set: every Sunday at ~9pm.');
  Logger.log('  Verify timezone in Project Settings matches America/Vancouver.');
}

// Run this to test the export immediately without waiting for Sunday
function testExportNow() {
  exportWeeklyClaims();
}

// ─── SHEET HELPERS (shared with web app) ──────────────

var HEADERS = {
  Patients:  ['id','last','first','phn','dob','sex','ward','bed','fac','refby','refbyName',
              'care','list','icd','roundedToday','discharged','dischargedAt','needsSticker'],
  Claims:    ['id','alias','docnum','last','first','phn','dob','sex','fee','feeCode','icd',
              'units','date','loc','fac','refby','refbyName','notes','startTime','submitted','submittedAt'],
  Referrers: ['id','last','first','num','spec'],
  Doctors:   ['alias','num','name'],
  ChangeLog: ['ts','patName','phn','action','detail','doctor'],
  Physicians:['last','first','num','spec','city'],
};

function getSheet(name) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (HEADERS[name]) sheet.appendRow(HEADERS[name]);
  }
  return sheet;
}

function sheetToObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i] === '' ? null : row[i]; });
    return obj;
  });
}

function findRowIndex(sheet, keyCol, keyVal) {
  var data = sheet.getDataRange().getValues();
  var ci   = data[0].indexOf(keyCol);
  if (ci < 0) return -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][ci]) === String(keyVal)) return i + 1;
  }
  return -1;
}

function objToRow(headers, obj) {
  return headers.map(function(h) {
    var v = obj[h];
    return (v === null || v === undefined) ? '' : v;
  });
}

function saveRow(sheetName, obj, keyField) {
  var sheet   = getSheet(sheetName);
  var headers = sheet.getDataRange().getValues()[0];
  var rowIdx  = findRowIndex(sheet, keyField, obj[keyField]);
  var row     = objToRow(headers, obj);
  if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
  return { ok: true };
}

function saveAll(sheetName, arr) {
  var sheet = getSheet(sheetName);
  var last  = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last - 1);
  if (!arr.length) return { ok: true };
  var headers = sheet.getDataRange().getValues()[0];
  var rows    = arr.map(function(obj) { return objToRow(headers, obj); });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return { ok: true };
}

function deleteRow(sheetName, id) {
  var sheet  = getSheet(sheetName);
  var rowIdx = findRowIndex(sheet, 'id', id);
  if (rowIdx > 0) sheet.deleteRow(rowIdx);
  return { ok: true };
}

function appendRow(sheetName, obj) {
  var sheet   = getSheet(sheetName);
  var headers = sheet.getDataRange().getValues()[0];
  sheet.appendRow(objToRow(headers, obj));
  return { ok: true };
}

function getAll() {
  return {
    patients:  sheetToObjects(getSheet('Patients')),
    claims:    sheetToObjects(getSheet('Claims')),
    refs:      sheetToObjects(getSheet('Referrers')),
    doctors:   sheetToObjects(getSheet('Doctors')),
    changelog: sheetToObjects(getSheet('ChangeLog')),
  };
}

function searchPhysicians(q) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Physicians');
  if (!sheet) return [];
  q = (q || '').toLowerCase().trim();
  if (!q || q.length < 2) return [];
  var data = sheet.getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < data.length && out.length < 15; i++) {
    var last  = String(data[i][0] || '').toLowerCase();
    var first = String(data[i][1] || '').toLowerCase();
    var num   = String(data[i][2] || '').toLowerCase();
    if (last.indexOf(q) !== -1 || first.indexOf(q) !== -1 || num.indexOf(q) !== -1) {
      out.push([data[i][0], data[i][1], data[i][2], data[i][3], data[i][4]]);
    }
  }
  return out;
}

// ── Date helpers ───────────────────────────────────────
function parseDMY(s) {
  if (!s) return 0;
  var p = String(s).split('/');
  if (p.length !== 3) return 0;
  return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])).getTime();
}

function getWeekStart() {
  var d = new Date();
  d.setDate(d.getDate() - 6); // 7 days ago
  return Utilities.formatDate(d, 'America/Vancouver', 'MMM d');
}

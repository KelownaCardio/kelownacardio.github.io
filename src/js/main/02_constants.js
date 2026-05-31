// 02_constants.js — Fee codes and comprehensive diagnosis list
// ICD-9-CM codes relevant to cardiology inpatient billing
// Covers cardiac, vascular, pulmonary, renal, metabolic,
// and common non-cardiac conditions seen on a cardiology service
// ═══════════════════════════════════════════════════════

// ── BC MSP 2025 Fee Values (cardiology) ──────────────
// Used only for motivational daily total display — not for billing submission
// Rates from BC MSC Payment Schedule effective January 31, 2026.
// FEE_RATES — numeric rate lookup ($ amount) keyed by MSP fee code, used
// by the daily-total math and the daily-claims modal.
//
// SINGLE SOURCE OF TRUTH: this table is DERIVED from the FEES catalogue
// (see buildFeeRates() just below the FEES definition). Do NOT hand-edit
// rates here — add or change a fee in FEES only, and FEE_RATES updates
// automatically. The declaration is left empty on purpose; it is filled
// once at load time, after FEES is defined. All reads happen inside
// functions that run later, so the empty stub is never observed.
var FEE_RATES = {};

function calcDailyTotal() {
  if (!st.doc || !st.claims) return null;
  var total = 0;
  var count = 0;
  st.claims.forEach(function(c) {
    if (c.alias !== st.doc.alias) return;
    if (c.date !== TODAY) return;
    if (c.fee === 'CCU_DAILY') return; // excluded — shown consolidated at export
    var rate = FEE_RATES[c.fee] || 0;
    total += rate * (c.units || 1);
    if (rate > 0) count++;
  });
  return count > 0 ? { total: total, count: count } : null;
}

// Format a DD/MM/YYYY string as "MMM DD, YYYY" (e.g. "May 07, 2026")
// Used in the header for a more readable date.
function dispDateMdy(d) {
  if (!d) return '';
  var s = fmtClaimDate(d);
  var p = s.split('/');
  if (p.length !== 3) return s;
  var mon = _MONTHS[parseInt(p[1], 10) - 1];
  if (!mon) return s;
  return mon + ' ' + p[0] + ', ' + p[2];
}

// Open the daily claims modal — shows Last,First — fee description for every claim
// the signed-in doctor has billed today. Quick visual check that nothing was missed.
function openDailyClaimsList() {
  if (!st.doc) { showToast('Sign in first'); return; }
  // Build fee-code → description lookup
  var feeDesc = {};
  FEES.forEach(function(f) { feeDesc[f.code] = f.desc; });
  // CCU rollups not in FEES
  feeDesc['CCU_DAILY'] = 'CCU daily (pre-rollup tap)';
  feeDesc['1411']      = 'CCU critical care — Day 1';
  feeDesc['1421']      = 'CCU critical care — Days 2-7';
  feeDesc['1431']      = 'CCU critical care — Day 8+';

  // Filter for today + this doctor
  var todays = (st.claims || []).filter(function(c) {
    return c.alias === st.doc.alias && c.date === TODAY;
  });

  // Sort: by last name, then by start time
  todays.sort(function(a, b) {
    var ln = String(a.last || '').localeCompare(String(b.last || ''));
    if (ln !== 0) return ln;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });

  var titleEl = document.getElementById('daily-claims-title');
  var body    = document.getElementById('daily-claims-body');
  if (!titleEl || !body) return;

  if (!todays.length) {
    titleEl.textContent = "Today's claims (0)";
    body.innerHTML = '<div class="empty" style="padding:18px 0">No claims billed today.</div>';
    showModal('daily-claims-modal');
    return;
  }

  // Total $ for the visible claims (excluding CCU_DAILY which rolls up)
  var total = 0;
  todays.forEach(function(c) {
    if (c.fee === 'CCU_DAILY') return;
    var rate = FEE_RATES[c.fee] || 0;
    total += rate * (c.units || 1);
  });

  titleEl.innerHTML = "Today's claims " +
    '<span style="font-weight:400;color:var(--text2);font-size:13px">(' +
    todays.length + ' &middot; $' + total.toFixed(0) + ')</span>';

  body.innerHTML = todays.map(function(c) {
    try {
      var last  = String(c.last  || '?');
      var first = String(c.first || '?');
      var fee   = String(c.fee   || '');
      var desc  = feeDesc[fee] || fee;
      var rate  = FEE_RATES[fee] || 0;
      var amt   = (rate * (c.units || 1));
      var time  = c.startTime ? String(c.startTime) : '';
      var isCCUTap = fee === 'CCU_DAILY';
      return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:8px 4px;border-bottom:.5px solid var(--border)">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text)">' +
            esc(last) + ', ' + esc(first) +
          '</div>' +
          '<div style="font-size:11px;color:var(--text2);margin-top:2px">' +
            esc(desc) +
            (time ? ' &middot; ' + esc(time) : '') +
            (isCCUTap ? ' <span style="color:var(--amber-t)">(rolls up at export)</span>' : '') +
          '</div>' +
        '</div>' +
        '<div style="font-size:12px;font-weight:700;color:' + (amt > 0 ? 'var(--green)' : 'var(--text3)') + ';flex-shrink:0">' +
          (amt > 0 ? '$' + amt.toFixed(0) : '—') +
        '</div>' +
      '</div>';
    } catch (e) {
      console.error('[dailyClaims] row render failed for', c, e);
      return '<div class="empty" style="padding:6px 4px;font-size:11px">⚠ Could not render claim ' + esc(c && c.id) + '</div>';
    }
  }).join('');

  showModal('daily-claims-modal');
}

function updateDailyTotal() {
  var result = calcDailyTotal();
  var dateEl = document.getElementById('hdr-date');
  if (!dateEl) return;
  var dateStr = dispDateMdy(TODAY);
  if (!result) {
    dateEl.innerHTML = '<span>' + dateStr + '</span>';
    return;
  }
  // Wrap the entire claims chip in a clickable button-like span so the whole
  // pill is tappable. font-size 12px (vs the old 9-13px mix) gives a comfortable
  // touch target. min-height ensures vertical hit area.
  dateEl.innerHTML =
    '<span>' + dateStr + '</span>' +
    '&nbsp; ' +
    '<span role="button" tabindex="0" onclick="openDailyClaimsList()" ' +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openDailyClaimsList();}" ' +
      'style="display:inline-block;cursor:pointer;padding:2px 8px;border-radius:10px;' +
      'background:var(--green-bg);color:var(--green-t);font-weight:700;font-size:12px;' +
      'line-height:1.4;min-height:18px;-webkit-tap-highlight-color:rgba(52,199,89,.2);' +
      'user-select:none">' +
      '$' + result.total.toFixed(0) +
      ' <span style="font-weight:500;opacity:.7">&middot; ' +
      result.count + ' claim' + (result.count !== 1 ? 's' : '') +
      '</span>' +
    '</span>';
}

// ─────────────────────────────────────────────────────────────────────────
// FEES — MSC Payment Schedule (January 31, 2026) — Kelowna Cardiology
//
// Each entry: { code, desc, amount, cat, clr }
//   - code   = MSP fee item submitted to iClinic
//   - desc   = official MSC description (paraphrased for brevity)
//   - amount = scheduled payment (BC MSP cardiology rate, Jan 2026)
//   - cat    = grouping for the picker
//   - clr    = chip colour class
//
// v3.29 (2026-05-10) — trimmed to the 20 codes the group actually bills.
// Echo, ECG, Holter, stress tests, pacemaker checks, remote monitoring,
// event recorders, and cardiac rehab codes are NOT included — those are
// billed by hospital / other specialty groups, not this cardiology
// service. Telehealth variants and 33007/33009 (office/home subseq)
// also removed per usage. If a service is later added back, restore
// the relevant codes from the MSC 2026 audit document.
// ─────────────────────────────────────────────────────────────────────────
var FEES = [
  // ── Consultations (yellow — matches calendar) ───────────────────
  { code:'33010',  desc:'Cardiology consultation — full',                                 amount:'$186.14', cat:'Consult',   clr:'chip-yellow' },
  { code:'33012',  desc:'Repeat / limited consultation (same illness, within 6 months)',  amount:'$93.08',  cat:'Consult',   clr:'chip-yellow' },
  { code:'33014',  desc:'Prolonged visit for counselling (max 4/year)',                   amount:'$66.47',  cat:'Consult',   clr:'chip-yellow' },
  { code:'33005',  desc:'Emergency visit when specially called',                          amount:'$97.15',  cat:'Consult',   clr:'chip-red'    },

  // ── Continuing care by consultant ────────────────────────────────
  { code:'33006',  desc:'Directive visit (max 2 per Sun–Sat week; 3rd requires note)',    amount:'$82.42',  cat:'Directive', clr:'chip-skyblue'},
  { code:'33008',  desc:'Subsequent hospital visit / MRP daily / combined daily care',    amount:'$63.95',  cat:'Daily',     clr:'chip-green'  },

  // ── Cardiology procedures performed by the group ─────────────────
  { code:'33025', desc:'Cardioversion',                                                  amount:'$105.70', cat:'Procedure',    clr:'chip-red'   },
  { code:'33030', desc:'Temporary pacemaker placement (TVP)',                            amount:'$176.07', cat:'Procedure',    clr:'chip-red'   },
  { code:'00751',  desc:'Pericardiocentesis (pericardial puncture)',                      amount:'$258.25', cat:'Procedure',    clr:'chip-red'   },

  // ── Diagnostics ─────────────────────────────────────────────────
  { code:'33035', desc:'Treadmill Test (GXT)',                                            amount:'$47.11',  cat:'Diagnostics', clr:'chip-teal'  },
  { code:'33093', desc:'Level 3 Echo Complex Assessment (Overread)',                     amount:'$252.39', cat:'Diagnostics', clr:'chip-teal'  },

  // ── Discharge / planning ────────────────────────────────────────
  { code:'78717',  desc:'Specialist discharge care plan for complex patients (extra)',    amount:'$82.19',  cat:'Discharge', clr:'chip-green' },
  { code:'78720',  desc:'Specialist advance care planning discussion / MOST (extra)',     amount:'$43.82',  cat:'Discharge', clr:'chip-green' },

  // ── CCU / Critical Care daily fees ──────────────────────────────
  { code:'1411',   desc:'CCU / ICU critical care — Day 1',                                amount:'$347.74', cat:'CCU',       clr:'chip-red'   },
  { code:'1421',   desc:'CCU / ICU critical care — Days 2–7 (per diem, max 6 units)',     amount:'$174.38', cat:'CCU',       clr:'chip-red'   },
  { code:'1431',   desc:'CCU / ICU critical care — Days 8–30',                            amount:'$133.01', cat:'CCU',       clr:'chip-red'   },
  { code:'1441',   desc:'CCU / ICU critical care — Day 31 onward',                        amount:'$138.53', cat:'CCU',       clr:'chip-red'   },

  // ── Call-out modifiers (all blue — matches MOST/calendar logic) ──
  { code:'1200',   desc:'Evening call modifier — base 30 min',                            amount:'$79.08',  cat:'Modifier',  clr:'chip-blue' },
  { code:'1201',   desc:'Night call modifier — base 30 min',                              amount:'$111.05', cat:'Modifier',  clr:'chip-blue' },
  { code:'1202',   desc:'Weekend/stat call modifier — base 30 min',                       amount:'$79.08',  cat:'Modifier',  clr:'chip-blue' },
  { code:'1205',   desc:'Evening call — increment per 30 min',                            amount:'$72.69',  cat:'Modifier',  clr:'chip-blue' },
  { code:'1206',   desc:'Night call — increment per 30 min',                              amount:'$99.40',  cat:'Modifier',  clr:'chip-blue' },
  { code:'1207',   desc:'Weekend/stat call — increment per 30 min',                       amount:'$72.69',  cat:'Modifier',  clr:'chip-blue' }
];

// ── Derive FEE_RATES from the FEES catalogue ───────────────────────────
// FEES (above) is the single source of truth for fee amounts. This builds
// the numeric FEE_RATES lookup by parsing each catalogue '$' amount once,
// so adding or repricing a fee means editing FEES only — the daily-total
// math stays in sync automatically. (Before v4.05 these were two separate
// hand-maintained tables; codes added to FEES but not FEE_RATES showed a
// dash and were dropped from the daily total.)
//
// CCU_DAILY is a synthetic pre-rollup tap with no catalogue entry — it is
// added explicitly with rate 0 and is excluded from the daily total
// (consolidated into 1411/1421/1431/1441 at export time).
function buildFeeRates() {
  var rates = { 'CCU_DAILY': 0 };
  FEES.forEach(function(f) {
    if (!f || !f.code) return;
    var n = parseFloat(String(f.amount || '').replace(/[^0-9.]/g, ''));
    if (!isNaN(n)) rates[f.code] = n;
  });
  return rates;
}
FEE_RATES = buildFeeRates();

// Legacy fee codes that appeared in older versions of this app but were
// invalid in MSC 2026 (14101/14105/14113). Kept so that historical claims
// in the Sheets render with a meaningful label rather than a bare code.
// NOT shown in the picker.
var LEGACY_FEE_LABELS = {
  '14101': 'Legacy code (was used for cardioversion; correct code is 33025)',
  '14105': 'Legacy code (was used for cardioversion; correct code is 33025)',
  '14113': 'Legacy code (was used for temp pacemaker; correct code is 33030)'
};

// ── Comprehensive ICD-9 diagnosis list ────────────────
// Format: { code, label } where label = "Description (code)"
// Grouped by category but stored flat for search.
// Cardiology-relevant codes prioritised; common comorbidities included.
var DIAGNOSES = [
  { code:'4280', label:'Congestive heart failure (4280)' },
  { code:'4281', label:'Left heart failure (4281)' },
  { code:'4289', label:'Heart failure, unspecified (4289)' },
  { code:'4273', label:'Atrial fibrillation / flutter (4273)' },
  { code:'4140', label:'Coronary atherosclerosis (CAD) (4140)' },
  { code:'4148', label:'Chronic ischemic heart disease (4148)' },
  { code:'411', label:'NSTEMI / unstable angina (411)' },
  { code:'4100', label:'Acute MI (4100)' },
  { code:'413', label:'Angina pectoris (413)' },
  { code:'4011', label:'Essential hypertension, benign (4011)' },
  { code:'4019', label:'Essential hypertension (4019)' },
  { code:'4254', label:'Primary cardiomyopathy, other (4254)' },
  { code:'4251', label:'Hypertrophic obstructive cardiomyopathy (HOCM) (4251)' },
  { code:'4271', label:'Ventricular tachycardia (4271)' },
  { code:'4275', label:'Cardiac arrest (4275)' },
  { code:'4279', label:'Dysrhythmia, unspecified (4279)' },
  { code:'4240', label:'Mitral valve disorder (4240)' },
  { code:'4241', label:'Aortic valve disorder (4241)' },
  { code:'4292', label:'Cardiovascular disease, unspecified (4292)' },
  { code:'4293', label:'Cardiomegaly (4293)' },
  { code:'4439', label:'Peripheral vascular disease (4439)' },
  { code:'4150', label:'Acute cor pulmonale (4150)' },
  { code:'4151', label:'Pulmonary embolism / infarction (4151)' },
  { code:'4168', label:'Chronic pulmonary heart disease (incl. pulm HTN) (4168)' },
  { code:'5849', label:'Acute kidney failure (5849)' },
  { code:'250', label:'Diabetes Mellitus (250)' },
  { code:'2500', label:'Diabetes Mellitus Without Mention Of Complication (2500)' },
  { code:'2501', label:'Diabetes With Ketoacidosis (2501)' },
  { code:'2502', label:'Diabetes With Coma (2502)' },
  { code:'2503', label:'Diabetes With Renal Manifestations (2503)' },
  { code:'2504', label:'Diabetes With Ophthalmic Manifestations (2504)' },
  { code:'2505', label:'Diabetes With Neurological Manifestations (2505)' },
  { code:'25050', label:'Diabetes With Ocular Involvment, Adult (25050)' },
  { code:'25051', label:'Diabetes With Ocular Involvment, Juvenile (25051)' },
  { code:'2506', label:'Diabetes With Peripheral Circulatory Disorders (2506)' },
  { code:'2507', label:'Diabetes With Other Specified Manifestations (2507)' },
  { code:'2509', label:'Diabetes With Unspecified Complications (2509)' },
  { code:'272', label:'Disorders Of Lipoid Metabolism (272)' },
  { code:'2720', label:'Pure Hypercholesterolaemia (2720)' },
  { code:'2721', label:'Pure Hyperglyceridaemia (2721)' },
  { code:'2722', label:'Mixed Hyperlipidaemia (2722)' },
  { code:'2723', label:'Hyperchylomicronaemia (2723)' },
  { code:'2724', label:'Other And Unspecified Hyperlipidaemia (2724)' },
  { code:'2725', label:'Lipoprotein Deficiencies (2725)' },
  { code:'2726', label:'Lipodystrophy (2726)' },
  { code:'2727', label:'Lipidoses (2727)' },
  { code:'2728', label:'Other Disorders Of Lipoid Metabolism (2728)' },
  { code:'2729', label:'Unspecified Disorders Of Lipoid Metabolism (2729)' },
  { code:'278', label:'Obesity And Other Hyperalimentation (278)' },
  { code:'2780', label:'Obesity (2780)' },
  { code:'2781', label:'Localized Adiposity (2781)' },
  { code:'2782', label:'Hypervitaminosis \'a\' (2782)' },
  { code:'2783', label:'Hypercarotinaemia (2783)' },
  { code:'2784', label:'Hypervitaminosis \'d\' (2784)' },
  { code:'2788', label:'Other (2788)' },
  { code:'390', label:'Rheumatic Fever Without Mention Of Heart Involvement (390)' },
  { code:'391', label:'Rheumatic Fever With Heart Involvement (391)' },
  { code:'3910', label:'Acute Rheumatic Pericarditis (3910)' },
  { code:'3911', label:'Acute Rheumatic Endocarditis (3911)' },
  { code:'3912', label:'Acute Rheumatic Myocarditis (3912)' },
  { code:'3918', label:'Other Acute Rheumatic Heart Disease (3918)' },
  { code:'3919', label:'Acute Rheumatic Heart Disease, Unspecified (3919)' },
  { code:'393', label:'Chronic Rheumatic Pericarditis (393)' },
  { code:'394', label:'Diseases Of Mitral Valve (394)' },
  { code:'3940', label:'Mitral Stenosis (3940)' },
  { code:'3941', label:'Rheumatic Mitral Insufficiency (3941)' },
  { code:'3942', label:'Mitral Stenosis With Insufficiency (3942)' },
  { code:'3949', label:'Other And Unspecified (3949)' },
  { code:'395', label:'Diseases Of Aortic Valve (395)' },
  { code:'3950', label:'Rheumatic Aortic Stenosis (3950)' },
  { code:'3951', label:'Rheumatic Aortic Insufficiency (3951)' },
  { code:'3952', label:'Rheumatic Aortic Stenosis With Insufficiency (3952)' },
  { code:'3959', label:'Other And Unspecified (3959)' },
  { code:'396', label:'Diseases Of Mitral And Aortic Valves (396)' },
  { code:'397', label:'Diseases Of Other Endocardial Structures (397)' },
  { code:'3970', label:'Diseases Of Tricuspid Valve (3970)' },
  { code:'3971', label:'Rheumatic Diseases Of Pulmonary Valve (3971)' },
  { code:'3979', label:'Rheumatic Diseases Of Endocardium, Valve Unspecified (3979)' },
  { code:'398', label:'Other Rheumatic Heart Disease (398)' },
  { code:'3980', label:'Rheumatic Myocarditis (3980)' },
  { code:'3989', label:'Other And Unspecified (3989)' },
  { code:'401', label:'Essential Hypertension (401)' },
  { code:'4010', label:'Specified AS Malignant (4010)' },
  { code:'402', label:'Hypertensive Heart Disease (402)' },
  { code:'4020', label:'Specified AS Malignant (4020)' },
  { code:'4021', label:'Specified AS Benign (4021)' },
  { code:'4029', label:'Not Specified AS Malignant Or Benign (4029)' },
  { code:'403', label:'Hypertensive Renal Disease (403)' },
  { code:'4030', label:'Hypertensive CKD, benign (4030)' },
  { code:'4031', label:'Specified AS Benign (4031)' },
  { code:'4039', label:'Hypertensive CKD (4039)' },
  { code:'404', label:'Hypertensive Heart And Renal Disease (404)' },
  { code:'4040', label:'Specified AS Malignant (4040)' },
  { code:'4041', label:'Specified AS Benign (4041)' },
  { code:'4049', label:'Not Specified AS Malignant Or Benign (4049)' },
  { code:'405', label:'Secondary Hypertension (405)' },
  { code:'4050', label:'Specified AS Malignant (4050)' },
  { code:'4051', label:'Specified AS Benign (4051)' },
  { code:'4059', label:'Not Specified AS Malignant Or Benign (4059)' },
  { code:'410', label:'Acute MI (unspecified site) (410)' },
  { code:'412', label:'Old Myocardial Infarction (412)' },
  { code:'414', label:'Other Forms Of Chronic Ischaemic Heart Disease (414)' },
  { code:'4141', label:'Aneurysm Of Heart (4141)' },
  { code:'4149', label:'Chronic ischemic heart disease, unspecified (4149)' },
  { code:'415', label:'Acute Pulmonary Heart Disease (415)' },
  { code:'416', label:'Chronic Pulmonary Heart Disease (416)' },
  { code:'4160', label:'Primary Pulmonary Hypertension (4160)' },
  { code:'4161', label:'Kyphoscoliotic Heart Disease (4161)' },
  { code:'4169', label:'Chronic pulmonary heart disease, unspecified (4169)' },
  { code:'417', label:'Other Diseases Of Pulmonary Circulation (417)' },
  { code:'4170', label:'Arteriovenous Fistula Of Pulmonary Vessels (4170)' },
  { code:'4171', label:'Aneurysm Of Pulmonary Artery (4171)' },
  { code:'4178', label:'Other (4178)' },
  { code:'4179', label:'Unspecified (4179)' },
  { code:'420', label:'Acute Pericarditis (420)' },
  { code:'4200', label:'Pericarditis In Diseases Classified Elsewhere (4200)' },
  { code:'4209', label:'Other And Unspecified Acute Pericarditis (4209)' },
  { code:'421', label:'Acute And Subacute Endocarditis (421)' },
  { code:'4210', label:'Acute And Subacute Bacterial Endocarditis (4210)' },
  { code:'4211', label:'Acute And Subacute Infective Endocarditis In Diseases Classified (4211)' },
  { code:'4219', label:'Acute Endocarditis, Unspecified (4219)' },
  { code:'422', label:'Acute Myocarditis (422)' },
  { code:'4220', label:'Acute Myocarditis In Diseases Classified Elsewhere (4220)' },
  { code:'4229', label:'Other And Unspecified Acute Myocarditis (4229)' },
  { code:'423', label:'Other Diseases Of Pericardium (423)' },
  { code:'4230', label:'Haemopericardium (4230)' },
  { code:'4231', label:'Adhesive Pericarditis (4231)' },
  { code:'4232', label:'Constrictive Pericarditis (4232)' },
  { code:'4238', label:'Other (4238)' },
  { code:'4239', label:'Unspecified (4239)' },
  { code:'424', label:'Other Diseases Of Endocardium (424)' },
  { code:'4242', label:'Tricuspid valve disorder (4242)' },
  { code:'4243', label:'Pulmonary valve disorder (4243)' },
  { code:'4249', label:'Endocarditis, Valve Unspecified (4249)' },
  { code:'425', label:'Cardiomyopathy (425)' },
  { code:'4250', label:'Endomyocardial Fibrosis (4250)' },
  { code:'4252', label:'Obscure Cardiomyopathy Of Africa (4252)' },
  { code:'4253', label:'Endocardial Fibroelastosis (4253)' },
  { code:'4255', label:'Alcoholic cardiomyopathy (4255)' },
  { code:'4256', label:'Cardiomyopathy In Chagas\'s Disease (4256)' },
  { code:'4257', label:'Nutritional And Metabolic Cardiomyopathies (4257)' },
  { code:'4258', label:'Cardiomyopathy In Other Diseases Classified Elsewhere (4258)' },
  { code:'4259', label:'Secondary cardiomyopathy (4259)' },
  { code:'426', label:'Conduction Disorders (426)' },
  { code:'4260', label:'AV block, complete (3rd degree) (4260)' },
  { code:'4261', label:'AV block, partial (4261)' },
  { code:'4262', label:'Left Bundle Branch Hemiblock (4262)' },
  { code:'4263', label:'Other LBBB (4263)' },
  { code:'4264', label:'RBBB (4264)' },
  { code:'4265', label:'Bundle branch block, other (4265)' },
  { code:'4266', label:'Other heart block (4266)' },
  { code:'4267', label:'Anomalous AV excitation (WPW) (4267)' },
  { code:'4268', label:'Other (4268)' },
  { code:'4269', label:'Unspecified (4269)' },
  { code:'427', label:'Cardiac Dysrhythmias (427)' },
  { code:'4270', label:'SVT (4270)' },
  { code:'4272', label:'Paroxysmal Tachycardia, Unspecified (4272)' },
  { code:'4274', label:'Ventricular fibrillation / flutter (4274)' },
  { code:'4276', label:'Premature beats (4276)' },
  { code:'4278', label:'Other dysrhythmia (4278)' },
  { code:'428', label:'Heart Failure (428)' },
  { code:'429', label:'Ill-defined Descriptions And Complications Of Heart Disease (429)' },
  { code:'4290', label:'Myocarditis, Unspecified (4290)' },
  { code:'4291', label:'Myocardial Degeneration (4291)' },
  { code:'4294', label:'Functional Disturbances Following Cardiac Surgery (4294)' },
  { code:'4295', label:'Rupture Of Chordae Tendinae (4295)' },
  { code:'4296', label:'Rupture Of Papillary Muscle (4296)' },
  { code:'4298', label:'Other heart disease (4298)' },
  { code:'4299', label:'Heart disease, unspecified (4299)' },
  { code:'430', label:'Subarachnoid Haemorrhage (430)' },
  { code:'431', label:'Intracerebral Haemorrhage (431)' },
  { code:'432', label:'Other And Unspecified Intracranial Haemorrhage (432)' },
  { code:'4320', label:'Nontraumatic Extradural Haemorrhage (4320)' },
  { code:'4321', label:'Subdural Haemorrhage (4321)' },
  { code:'4329', label:'Unspecified Intracranial Haemorrhage (4329)' },
  { code:'433', label:'Occlusion And Stenosis Of Precerebral Arteries (433)' },
  { code:'4330', label:'Basilar Artery (4330)' },
  { code:'4331', label:'Carotid Artery (4331)' },
  { code:'4332', label:'Vertebral Artery (4332)' },
  { code:'4333', label:'Multiple And Bilateral (4333)' },
  { code:'4338', label:'Other (4338)' },
  { code:'4339', label:'Unspecified (4339)' },
  { code:'434', label:'Occlusion Of Cerebral Arteries (434)' },
  { code:'4340', label:'Cerebral Thrombosis (4340)' },
  { code:'4341', label:'Cerebral Embolism (4341)' },
  { code:'4349', label:'Unspecified (4349)' },
  { code:'435', label:'Transient Cerebral Ischaemia (435)' },
  { code:'436', label:'Acute But Ill-defined Cerebrovascular Disease (436)' },
  { code:'43600', label:' (43600)' },
  { code:'437', label:'Other And Ill-defined Cerebrovascular Disease (437)' },
  { code:'4370', label:'Cerebral Atherosclerosis (4370)' },
  { code:'4371', label:'Other Generalized Ischaemic Cerebrovascular Disease (4371)' },
  { code:'4372', label:'Hypertensive Encephalopathy (4372)' },
  { code:'4373', label:'Cerebral Aneurysm, Nonruptured (4373)' },
  { code:'4374', label:'Cerebral Arteritis (4374)' },
  { code:'4375', label:'Moyamoya Disease (4375)' },
  { code:'4376', label:'Nonpyogenic Thrombosis Of Intracranial Venous Sinus (4376)' },
  { code:'4378', label:'Other (4378)' },
  { code:'4379', label:'Unspecified (4379)' },
  { code:'438', label:'Late Effects Of Cerebrovascular Disease (438)' },
  { code:'440', label:'Atherosclerosis (440)' },
  { code:'4400', label:'Of Aorta (4400)' },
  { code:'4401', label:'Of Renal Artery (4401)' },
  { code:'4402', label:'Of Arteries Of The Extremities (4402)' },
  { code:'4408', label:'Of Other Specified Arteries (4408)' },
  { code:'4409', label:'Generalized And Unspecified (4409)' },
  { code:'441', label:'Aortic Aneurysm (441)' },
  { code:'4410', label:'Dissecting Aneurysm (any Part) (4410)' },
  { code:'4411', label:'Thoracic Aneurysm, Ruptured (4411)' },
  { code:'4412', label:'Thoracic Aneurysm Without Mention Of Rupture (4412)' },
  { code:'4413', label:'Abdominal Aneurysm, Ruptured (4413)' },
  { code:'4414', label:'Abdominal Aneurysm Without Mention Of Rupture (4414)' },
  { code:'4415', label:'Aortic Aneurysm Of Unspecified Site, Ruptured (4415)' },
  { code:'4416', label:'Aortic Aneurysm Of Unspecified Site Without Mention Of Rupture (4416)' },
  { code:'4417', label:'Syphilitic Aneurysm Of Aorta (4417)' },
  { code:'442', label:'Other Aneurysm (442)' },
  { code:'4420', label:'Of Artery Of Upper Extremity (4420)' },
  { code:'4421', label:'Of Renal Artery (4421)' },
  { code:'4422', label:'Of Iliac Artery (4422)' },
  { code:'4423', label:'Of Artery Of Lower Extremity (4423)' },
  { code:'4428', label:'Of Other Specified Artery (4428)' },
  { code:'4429', label:'Of Unspecified Site (4429)' },
  { code:'443', label:'Other Peripheral Vascular Disease (443)' },
  { code:'4430', label:'Raynaud\'s Syndrome (4430)' },
  { code:'4431', label:'Thromboangiitis Obliterans (buerger\'s Disease) (4431)' },
  { code:'4438', label:'Other (4438)' },
  { code:'444', label:'Arterial Embolism And Thrombosis (444)' },
  { code:'4440', label:'Of Abdominal Aorta (4440)' },
  { code:'4441', label:'Of Other Aorta (4441)' },
  { code:'4442', label:'Of Arteries Of The Extremities (4442)' },
  { code:'4448', label:'Of Other Specified Artery (4448)' },
  { code:'4449', label:'Of Unspecified Artery (4449)' },
  { code:'446', label:'Polyarteritis Nodosa And Allied Conditions (446)' },
  { code:'4460', label:'Polyarteritis Nodosa (4460)' },
  { code:'4461', label:'Acute Febrile Mucocutaneous Lymphnode Syndrome (mcls) (4461)' },
  { code:'4462', label:'Hypersensitivity Angiitis (4462)' },
  { code:'4463', label:'Lethal Midline Granuloma (4463)' },
  { code:'4464', label:'Wegener\'s Granulomatosis (4464)' },
  { code:'4465', label:'Giant Cell Arteritis (4465)' },
  { code:'44650', label:'Giant Cell Arteritis (44650)' },
  { code:'4466', label:'Thrombotic Microangiopathy (4466)' },
  { code:'4467', label:'Takayasu Disease (4467)' },
  { code:'447', label:'Other Disorders Of Arteries And Arterioles (447)' },
  { code:'4470', label:'Arteriovenous Fistula, Acquired (4470)' },
  { code:'4471', label:'Stricture Of Artery (4471)' },
  { code:'4472', label:'Rupture Of Artery (4472)' },
  { code:'4473', label:'Hyperplasia Of Renal Artery (4473)' },
  { code:'4474', label:'Coeliac Artery Compression Syndrome (4474)' },
  { code:'4475', label:'Necrosis Of Artery (4475)' },
  { code:'4476', label:'Arteritis, Unspecified (4476)' },
  { code:'4477', label:'Syphilitic Aortitis (4477)' },
  { code:'4478', label:'Other (4478)' },
  { code:'4479', label:'Unspecified (4479)' },
  { code:'448', label:'Diseases Of Capillaries (448)' },
  { code:'4480', label:'Hereditary Haemorrhagic Telangiectasia (4480)' },
  { code:'4481', label:'Naevus, Non-neoplastic (4481)' },
  { code:'4489', label:'Other And Unspecified (4489)' },
  { code:'451', label:'Phlebitis And Thrombophlebitis (451)' },
  { code:'4510', label:'Of Superficial Vessels Of Lower Extremities (4510)' },
  { code:'4511', label:'Of Deep Vessels Of Lower Extremities (4511)' },
  { code:'4512', label:'Of Lower Extremities, Unspecified (4512)' },
  { code:'4518', label:'Of Other Sites (4518)' },
  { code:'4519', label:'Of Unspecified Site (4519)' },
  { code:'452', label:'Portal Vein Thrombosis (452)' },
  { code:'453', label:'Other Venous Embolism And Thrombosis (453)' },
  { code:'4530', label:'Budd-chiari Syndrome (4530)' },
  { code:'4531', label:'Thrombophlebitis Migrans (4531)' },
  { code:'4532', label:'Of Vena Cava (4532)' },
  { code:'4533', label:'Of Renal Vein (4533)' },
  { code:'4538', label:'Of Other Specified Veins (4538)' },
  { code:'4539', label:'Of Unspecified Site (4539)' },
  { code:'454', label:'Varicose Veins Of Lower Extremities (454)' },
  { code:'4540', label:'With Ulcer (4540)' },
  { code:'4541', label:'With Inflammation (4541)' },
  { code:'4542', label:'With Ulcer And Inflammation (4542)' },
  { code:'4549', label:'Without Mention Of Ulcer Or Inflammation (4549)' },
  { code:'455', label:'Haemorrhoids (455)' },
  { code:'4550', label:'Internal Haemorrhoids, Without Mention Of Complication (4550)' },
  { code:'4551', label:'Internal Thrombosed Haemorrhoids (4551)' },
  { code:'4552', label:'Internal Haemorrhoids With Other Complication (4552)' },
  { code:'4553', label:'External Haemorrhoids Without Mention Of Complication (4553)' },
  { code:'4554', label:'External Thrombosed Haemorrhoids (4554)' },
  { code:'4555', label:'External Haemorrhoids With Other Complication (4555)' },
  { code:'4556', label:'Unspecified Haemorrhoids, Without Mention Of Complication (4556)' },
  { code:'4557', label:'Unspecified Thrombosed Haemorrhoids (4557)' },
  { code:'4558', label:'Unspecified Haemorrhoids With Other Complication (4558)' },
  { code:'4559', label:'Residual Haemorrhoidal Skin Tags (4559)' },
  { code:'456', label:'Varicose Veins Of Other Sites (456)' },
  { code:'4560', label:'Oesophageal Varices With Bleeding (4560)' },
  { code:'4561', label:'Oesophageal Varices Without Mention Of Bleeding (4561)' },
  { code:'4562', label:'Oesophageal Varices In Cirrhosis Of Liver (4562)' },
  { code:'4563', label:'Sublingual Varices (4563)' },
  { code:'4564', label:'Scrotal Varices (4564)' },
  { code:'4565', label:'Pelvic Varices (4565)' },
  { code:'4566', label:'Vulval Varices (4566)' },
  { code:'4568', label:'Other (4568)' },
  { code:'457', label:'Noninfective Disorders Of Lymphatic Channels (457)' },
  { code:'4570', label:'Postmastectomy Lymphoedema Syndrome (4570)' },
  { code:'4571', label:'Other Lymphoedema (4571)' },
  { code:'4572', label:'Lymphangitis (4572)' },
  { code:'4578', label:'Other Noninfective Disorders Of Lymphatic Channels (4578)' },
  { code:'4579', label:'Unspecified (4579)' },
  { code:'458', label:'Hypotension (458)' },
  { code:'4580', label:'Orthostatic Hypotension (4580)' },
  { code:'4581', label:'Chronic Hypotension (4581)' },
  { code:'4589', label:'Unspecified (4589)' },
  { code:'459', label:'Other Disorders Of Circulatory System (459)' },
  { code:'4590', label:'Haemorrhage, Unspecified (4590)' },
  { code:'4591', label:'Post-phlebitic Syndrome (4591)' },
  { code:'4592', label:'Compression Of Vein (4592)' },
  { code:'4598', label:'Other (4598)' },
  { code:'4599', label:'Unspecified (4599)' },
  { code:'485', label:'Bronchopneumonia, Organism Unspecified (485)' },
  { code:'486', label:'Pneumonia, Organism Unspecified (486)' },
  { code:'491', label:'Chronic Bronchitis (491)' },
  { code:'4910', label:'Simple Chronic Bronchitis (4910)' },
  { code:'4911', label:'Mucopurulent Chronic Bronchitis (4911)' },
  { code:'4912', label:'Obstructive Chronic Bronchitis (4912)' },
  { code:'4918', label:'Other Chronic Bronchitis (4918)' },
  { code:'4919', label:'Unspecified (4919)' },
  { code:'492', label:'Emphysema (492)' },
  { code:'4920', label:'Airway - Obstruct With Emphysema (4920)' },
  { code:'493', label:'Asthma (493)' },
  { code:'4930', label:'Extrinsic Asthma (4930)' },
  { code:'4931', label:'Intrinsic Asthma (4931)' },
  { code:'4939', label:'Asthma, Unspecified (4939)' },
  { code:'496', label:'Chronic Airways Obstruction, Not Elsewhere Classified (496)' },
  { code:'584', label:'Acute Renal Failure (584)' },
  { code:'5845', label:'With Lesion Of Tubular Necrosis (5845)' },
  { code:'5846', label:'With Lesion Of Renal Cortical Necrosis (5846)' },
  { code:'5847', label:'With Lesion Of Renal Medullary (papillary) Necrosis (5847)' },
  { code:'5848', label:'With Other Specified Pathological Lesion In Kidney (5848)' },
  { code:'585', label:'Chronic Renal Failure (585)' },
  { code:'745', label:'Bulbus Cordis Anomalies And Anomalies Of Cardiac Septal Closure (745)' },
  { code:'7450', label:'Common Truncus (7450)' },
  { code:'7451', label:'Transposition Of Great Vessels (7451)' },
  { code:'7452', label:'Tetralogy Of Fallot (7452)' },
  { code:'7453', label:'Common Ventricle (7453)' },
  { code:'7454', label:'Ventricular Septal Defect (7454)' },
  { code:'7455', label:'Ostium Secundum Type Atrial Septal Defect (7455)' },
  { code:'7456', label:'Endocardial Cushion Defects (7456)' },
  { code:'7457', label:'Cor Biloculare (7457)' },
  { code:'7458', label:'Other (7458)' },
  { code:'7459', label:'Unspecified Defect Of Septal Closure (7459)' },
  { code:'746', label:'Other Congenital Anomalies Of Heart (746)' },
  { code:'7460', label:'Anomalies Of Pulmonary Valve (7460)' },
  { code:'7461', label:'Tricuspid Atresia And Stenosis, Congenital (7461)' },
  { code:'7462', label:'Ebstein\'s Anomaly (7462)' },
  { code:'7463', label:'Congenital Stenosis Of Aortic Valve (7463)' },
  { code:'7464', label:'Congenital Insufficiency Of Aortic Valve (7464)' },
  { code:'7465', label:'Congenital Mitral Stenosis (7465)' },
  { code:'7466', label:'Congenital Mitral Insufficiency (7466)' },
  { code:'7467', label:'Hypoplastic Left Heart Syndrome (7467)' },
  { code:'7468', label:'Other Specified Anomalies Of Heart (7468)' },
  { code:'7469', label:'Unspecified Anomalies Of Heart (7469)' },
  { code:'747', label:'Other Congenital Anomalies Of Circulatory System (747)' },
  { code:'7470', label:'Patent Ductus Arteriosus (7470)' },
  { code:'7471', label:'Coarctation Of Aorta (7471)' },
  { code:'7472', label:'Other Anomalies Of Aorta (7472)' },
  { code:'7473', label:'Anomalies Of Pulmonary Artery (7473)' },
  { code:'7474', label:'Anomalies Of Great Veins (7474)' },
  { code:'7475', label:'Absence Or Hypoplasia Of Umbilical Artery (7475)' },
  { code:'7476', label:'Other Anomalies Of Peripheral Vascular System (7476)' },
  { code:'7478', label:'Other Specified Anomalies Of Circulatory System (7478)' },
  { code:'7479', label:'Unspecified Anomalies Of Circulatory System (7479)' },
  { code:'785', label:'Symptoms Involving Cardiovascular System (785)' },
  { code:'7850', label:'Tachycardia, unspecified (7850)' },
  { code:'7851', label:'Palpitations (7851)' },
  { code:'7852', label:'Functional And Undiagnosed Cardiac Murmurs (7852)' },
  { code:'7853', label:'Other Abnormal Heart Sounds (7853)' },
  { code:'7854', label:'Gangrene (7854)' },
  { code:'7855', label:'Shock Without Mention Of Trauma (7855)' },
  { code:'7856', label:'Enlargement Of Lymph Nodes (7856)' },
  { code:'7859', label:'Other (7859)' },
  { code:'786', label:'Symptoms Involving Respiratory System And Other Chest Symptoms (786)' },
  { code:'7860', label:'Dyspnoea And Respiratory Abnormalities (7860)' },
  { code:'7861', label:'Stridor / abnormal breathing (7861)' },
  { code:'7862', label:'Cough (7862)' },
  { code:'7863', label:'Haemoptysis (7863)' },
  { code:'7864', label:'Abnormal Sputum (7864)' },
  { code:'7865', label:'Chest Pain (7865)' },
  { code:'7866', label:'Swelling, Mass Or Lump In Chest (7866)' },
  { code:'7867', label:'Abnormal Chest Sounds (7867)' },
  { code:'7868', label:'Hiccough (7868)' },
  { code:'7869', label:'Other (7869)' }
];

// Meditech OCR: diagnosis text → ICD-9 code (first match wins)
var DX_MAP = [
  ['non st elev','410'],['nstemi','410'],['inferior stemi','410'],['stemi','410'],
  ['congestive heart fail','428'],['decompensated','428'],['chf','428'],
  ['systolic heart fail','428.0'],['diastolic heart fail','428.9'],
  ['afib','427.3'],['atrial fib','427.3'],['atrial flutter','427.3'],
  ['ventricular tach','427.1'],['v.tach','427.1'],['vtach','427.1'],
  ['ventricular fib','427.4'],['v.fib','427.4'],['cardiac arrest','427.5'],
  ['bradycard','427.9'],['heart block','426.0'],['mobitz','426.1'],
  ['unstable angina','411'],['aortic stenosis','424.1'],['aortic insuf','424.1'],
  ['mitral','424.0'],['pericardial effusion','420.9'],['pericarditis','420.9'],
  ['endocarditis','421.0'],['myocarditis','422.9'],['tamponade','423.1'],
  ['cardiomyopathy','425.4'],['hocm','425.1'],['takotsubo','429.8'],
  ['left main','414.0'],['coronary artery','414.0'],['cabg','414.0'],
  ['pulmonary embol','415.1'],['pulmonary hypert','416.0'],
  ['aortic dissect','441.0'],['aneurysm','441.4'],
  ['infected','996'],['device infect','996'],['pacemaker complication','996'],
  ['cardiogenic shock','785.5'],['septic shock','785.5'],
  ['dyspnea','786.0'],['shortness of breath','786.0'],
  ['chest pain','786.5'],['palpitation','785.0'],['syncope','780.2'],
  ['sepsis','038.9'],['hypertension','401.9'],
  ['acute renal','584'],['aki','584'],['chronic kidney','585'],['ckd','585'],
  ['diabetes','250.0'],['dvt','453.9'],['deep vein','453.9'],
  ['stroke','434.9'],['tia','435'],['pneumonia','486'],['copd','496'],
];

function diagToIcd(reason) {
  if (!reason) return '3062';
  var r = reason.toLowerCase();
  for (var i = 0; i < DX_MAP.length; i++) {
    if (r.indexOf(DX_MAP[i][0]) !== -1) return DX_MAP[i][1];
  }
  return '3062';
}

function getOrderedDiagnoses() {
  var recent = (st && st.recentIcds) ? st.recentIcds : [];
  var recentCodes = recent.map(function(r) { return r.code; });
  var recentItems = recentCodes.map(function(code) {
    return DIAGNOSES.find(function(d) { return d.code === code; });
  }).filter(Boolean);
  var rest = DIAGNOSES.filter(function(d) { return recentCodes.indexOf(d.code) === -1; });
  return recentItems.concat(rest);
}

function recordIcdUsage(code) {
  if (!st.recentIcds) st.recentIcds = [];
  st.recentIcds = st.recentIcds.filter(function(r) { return r.code !== code; });
  st.recentIcds.unshift({ code: code });
  if (st.recentIcds.length > 5) st.recentIcds = st.recentIcds.slice(0, 5);
  sv('recentIcds', st.recentIcds);
}

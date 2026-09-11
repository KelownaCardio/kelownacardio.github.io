// 01_config.js — URLs, ward definitions, alias map
// ═══════════════════════════════════════════════════════

// ─── v5.20 (2026-09-10): TWO DOORS TO THE SAME BACKEND ─────────────────
// EXEC_URL  = the Apps Script web-app address (the only door until v5.19).
//             A 1-hour wired-Mac probe on 2026-09-10 showed it holds or drops
//             ~6% of requests for 20–45s before the script even starts — the
//             source of the "network unavailable" prompts.
// RELAY_URL = a Cloudflare Worker that calls the SAME script through the
//             Apps Script API (no redirect leg). Same key, same routing,
//             same JSON. Default door from v5.20.
// SHEETS_URL is whichever door is in use right now (every module reads it).
// Per-device override: localStorage 'kgh5:door' = 'exec' | 'relay'.
// Automatic failover: if the relay fails a whole retry chain, the app falls
// back to EXEC_URL for 10 minutes, then tries the relay again (03_state.js
// _doorFailover / _doorMaybeRestore).
var EXEC_URL  = 'https://script.google.com/macros/s/AKfycbxnd8SjEggYszjTQ3Ljcy7IlSK8PFUuXJwwKggjEqqZrWn9ED0zV3OlfQ6ka5m9y-c_/exec';
var RELAY_URL = 'https://kgh-relay.kathrynb77.workers.dev';
var DOOR_FAILBACK_MS = 10 * 60 * 1000;
// PILOT (v5.20): only these signed-in aliases use the relay; everyone else
// stays on /exec exactly as before. Flip RELAY_ALL to true (v5.21) to move
// every device over; set RELAY_URL = '' to retire the relay entirely.
var RELAY_ALL   = false;
var RELAY_PILOT = ['KBrown', 'AKhosla'];   // v5.21 (2026-09-11): + AKhosla (Android, on service) as the second pilot
var _doorPref = '';
try { _doorPref = localStorage.getItem('kgh5:door') || ''; } catch (e) {}
// The signed-in doctor is not known until loadLocal() runs, so the app starts
// on /exec and _doorMaybeRestore() (03_state.js, top of every sync) moves a
// pilot device onto the relay before its first request goes out.
var SHEETS_URL = EXEC_URL;
function currentDoor() { return (SHEETS_URL === RELAY_URL) ? 'relay' : 'exec'; }
function relayEnabledForThisDevice() {
  if (!RELAY_URL) return false;
  if (_doorPref === 'exec') return false;
  if (_doorPref === 'relay' || RELAY_ALL) return true;
  try {
    var a = (typeof st !== 'undefined' && st && st.doc) ? String(st.doc.alias || '') : '';
    return a && RELAY_PILOT.indexOf(a) >= 0;
  } catch (e) { return false; }
}
var APP_PW_LS_KEY = 'kgh5:appPw';
var SHARED_KEY = '';
try { SHARED_KEY = localStorage.getItem(APP_PW_LS_KEY) || ''; } catch (e) { SHARED_KEY = ''; }

// v4.85: in-app aliases standardized to first-initial-lastname. The iClinic
// payee alias is applied only at CSV export (backend canonAlias_ /
// DOCTOR_ALIAS_CANON). NOTE: ALIAS_MAP is not currently referenced anywhere;
// kept aligned to the standard so it stays correct if ever wired up.
var ALIAS_MAP = {
  FH:'FHalperin', LH:'LHalperin', DP:'DPatton', KB:'KBrown', JKT:'KTodd',
  JW:'JWebber', KH:'KHoskin', AS:'ASodhi', AK:'AKhosla', EM:'EMMassie',
  SB:'SBaker', KP:'KPistawka'
};

// Pre-loaded doctor profiles — shown in sign-in screen on first launch only
// (overwritten by the live Doctors tab on first sync). Aliases follow the
// first-initial-lastname standard; iClinic codes live in the backend canon map.
var DOCTORS_SEED = [
  { alias:'FHalperin', name:'Dr. Frank Halperin'  },
  { alias:'LHalperin', name:'Dr. Laura Halperin'  },
  { alias:'DPatton',   name:'Dr. Daniel Patton'   },
  { alias:'KBrown',    name:'Dr. Kathryn Brown'   },
  { alias:'KTodd',     name:'Dr. Keith Todd'      },
  { alias:'JWebber',   name:'Dr. Jordan Webber'   },
  { alias:'KHoskin',   name:'Dr. Kurt Hoskin'     },
  { alias:'ASodhi',    name:'Dr. Amit Sodhi'      },
  { alias:'AKhosla',   name:'Dr. Amit Khosla'     },
  { alias:'EMMassie',  name:'Dr. Emma Massie'     },
  { alias:'SBaker',    name:'Dr. Sandy Baker'     },
  { alias:'KPistawka', name:'Dr. Kevin Pistawka'  },
];

// Ward definitions: label, default list, default care type, preset rooms
var WARDS = {
  CCU:  { label:'CICU',     list:'on',  care:'ccu',      role:'mrp',       rooms:['1','2','3','4','5','6','7','8'] },
  '2S': { label:'2S',       list:'on',  care:'daily',    role:'mrp',     rooms:['217','218','219','220','221','222','223','224','225A','225B','226A','226B','227','228','229','230','231','232','233','234','Hallway A','Hallway B'] },
  '2W': { label:'2W',       list:'on',  care:'daily',    role:'mrp',     rooms:['201','202','203','204','205','206','207','208','209','210','211','212','213','214','215','216','Hallway'] },
  // v4.76: holding areas where patients wait for a bed. Neutral defaults on
  // purpose (Kathryn 2026-07-16: "MD will pick one manually") — same pattern
  // as the other non-core wards; the MD sets list/care/role per patient.
  RACE: { label:'Race Admit', list:'off', care:'directive', role:'consultant', rooms:[] },
  PCATH:{ label:'Post Cath',  list:'off', care:'directive', role:'consultant', rooms:[] },
  CSICU:{ label:'CSICU',    list:'off', care:'combined',  role:'consultant',  rooms:[] },
  ICUA: { label:'ICU A',    list:'off', care:'combined',  role:'consultant',  rooms:[] },
  ICUB: { label:'ICU B',    list:'off', care:'combined',  role:'consultant',  rooms:[] },
  ICUD: { label:'ICU D',    list:'off', care:'combined',  role:'consultant',  rooms:[] },
  ED:   { label:'ED',       list:'off', care:'directive', role:'consultant', rooms:[],
          roomGroups: [
            { label:'Trauma',   prefix:'Trauma',          rooms:['1','2','3'] },
            { label:'Main',     prefix:'Main',            rooms:['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15'] },
            { label:'BCAS',     prefix:'BCAS',            rooms:['A','B','C','D'] },
            { label:'Streaming',prefix:'Streaming',       rooms:[] },
            { label:'Minor Tx', prefix:'Minor Treatment', rooms:[] },
            { label:'C1',       prefix:'C1',              rooms:[] }
          ] },
  '3E': { label:'3E',       list:'off', care:'directive', role:'consultant', rooms:[] },
  '3W': { label:'3W',       list:'off', care:'directive', role:'consultant', rooms:[] },
  '3MU':{ label:'3MU',      list:'off', care:'directive', role:'consultant', rooms:[] },
  '4A': { label:'4A',          list:'off', care:'directive', role:'consultant', rooms:[] },
  '4B': { label:'4B',          list:'off', care:'directive', role:'consultant', rooms:[] },
  '4E': { label:'4E',          list:'off', care:'directive', role:'consultant', rooms:[] },
  '4W': { label:'4W',          list:'off', care:'directive', role:'consultant', rooms:[] },
  '5A': { label:'5A',          list:'off', care:'directive', role:'consultant', rooms:[] },
  '5B': { label:'5B',          list:'off', care:'directive', role:'consultant', rooms:[] },
  REHAB:{ label:'Rehab',       list:'off', care:'directive', role:'consultant', rooms:[] },
  '6W': { label:'6W',          list:'off', care:'directive', role:'consultant', rooms:[] },
  PAR:  { label:'Centennial PAR', list:'off', care:'directive', role:'consultant', rooms:[] },
  IHSC1:{ label:'IHSC1',       list:'off', care:'directive', role:'consultant', rooms:[] },
  C1C:  { label:'C1C',         list:'off', care:'directive', role:'consultant', rooms:[] },
  HAH:  { label:'HAH',         list:'off', care:'directive', role:'consultant', rooms:[] },
  OTHER:{ label:'Other',       list:'off', care:'directive', role:'consultant', rooms:[] }
};

var OCR_WORKER_URL = 'https://kgh-ocr.kathrynb77.workers.dev';


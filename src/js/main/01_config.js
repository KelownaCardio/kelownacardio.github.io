// 01_config.js — URLs, ward definitions, alias map
// ═══════════════════════════════════════════════════════

var SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxnd8SjEggYszjTQ3Ljcy7IlSK8PFUuXJwwKggjEqqZrWn9ED0zV3OlfQ6ka5m9y-c_/exec';
var APP_PW_LS_KEY = 'kgh5:appPw';
var SHARED_KEY = '';
try { SHARED_KEY = localStorage.getItem(APP_PW_LS_KEY) || ''; } catch (e) { SHARED_KEY = ''; }

var ALIAS_MAP = {
  FH:'FH', LH:'LH', DP:'DPatton', KB:'KBrown', JKT:'KT',
  JW:'JW', KH:'KHoskin', AS:'ASodhi', AK:'AKhosla', EM:'EMMassie', SB:'SB'
};

// Pre-loaded doctor profiles — shown in sign-in screen on first launch
// num = MSP billing number (fill in if not already in the app)
var DOCTORS_SEED = [
  { alias:'FH',      name:'Dr. Frank Halperin'  },
  { alias:'LH',      name:'Dr. Laura Halperin'  },
  { alias:'DPatton', name:'Dr. Daniel Patton'   },
  { alias:'KBrown',  name:'Dr. Kathryn Brown'   },
  { alias:'KT',      name:'Dr. Keith Todd'      },
  { alias:'JW',      name:'Dr. Jordan Webber'   },
  { alias:'KHoskin', name:'Dr. Kurt Hoskin'     },
  { alias:'ASodhi',  name:'Dr. Amit Sodhi'      },
  { alias:'AKhosla', name:'Dr. Amit Khosla'     },
  { alias:'EMMassie',name:'Dr. Emma Massie'     },
  { alias:'SB',      name:'Dr. Sandy Baker'     },
];

// Ward definitions: label, default list, default care type, preset rooms
var WARDS = {
  CCU:  { label:'CICU',     list:'on',  care:'ccu',      role:'mrp',       rooms:['1','2','3','4','5','6','7','8'] },
  '2S': { label:'2S',       list:'on',  care:'daily',    role:'mrp',     rooms:['217','218','219','220','221','222','223','224','225A','225B','226A','226B','227','228','229','230','231','232','233','234','Hallway A','Hallway B'] },
  '2W': { label:'2W',       list:'on',  care:'daily',    role:'mrp',     rooms:['201','202','203','204','205','206','207','208','209','210','211','212','213','214','215','216','Hallway'] },
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


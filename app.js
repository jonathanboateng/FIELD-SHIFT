const NASA_KEY = 'mPKmwKWJBc96g6B76FbHb7HKNMKNmKbm8rNHCw6G';
const CROPS = {
  maize:    {name:'Maize', emoji:'🌽', family:'cereal', water:'medium', note:'Needs steady water. Good choice right now.'},
  rice:     {name:'Rice', emoji:'🌾', family:'cereal', water:'high', note:'Needs lots of water — best when field stays wet.'},
  cassava:  {name:'Cassava', emoji:'🍠', family:'root', water:'low', note:'Tough crop, survives dry spells well.'},
  sorghum:  {name:'Sorghum / Millet', emoji:'🌾', family:'cereal', water:'low', note:'Handles heat and dry soil well.'},
  cowpea:   {name:'Cowpea (beans)', emoji:'🫘', family:'legume', water:'low', note:'Feeds the soil for your next crop.'},
  groundnut:{name:'Groundnut', emoji:'🥜', family:'legume', water:'medium', note:'Good for resting the soil.'},
  okra:     {name:'Okra', emoji:'🫛', family:'vegetable', water:'medium', note:'Grows fast, moderate water needed.'},
  tomato:   {name:'Tomato', emoji:'🍅', family:'vegetable', water:'high', note:'Needs regular watering, avoid if dry.'},
  pepper:   {name:'Pepper', emoji:'🌶️', family:'vegetable', water:'medium', note:"Moderate water, don't overwater."},
  soybean:  {name:'Soybean', emoji:'🫛', family:'legume', water:'medium', note:'Good partner after maize or rice.'}
};
const LAST_FAMILY = {none:null, maize:'cereal', rice:'cereal', cassava:'root', legume:'legume', vegetable:'vegetable', sorghum:'cereal'};

async function fetchFieldData(lat, lon) {
  const end = new Date();
  const start = new Date(end.getTime() - 30*24*3600*1000);
  const fmt = d => d.toISOString().slice(0,10).replace(/-/g,'');
  const params = ['T2M','PRECTOTCORR','GWETROOT','GWETTOP','RH2M'];
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params.join(',')}&community=AG&longitude=${lon}&latitude=${lat}&start=${fmt(start)}&end=${fmt(end)}&format=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('weather data unavailable');
  const data = await res.json();
  const p = data.properties.parameter;
  const avg = arr => { const v = Object.values(arr).filter(x => x > -900); return v.reduce((a,b)=>a+b,0)/v.length; };
  const series = arr => Object.values(arr).map(x => x > -900 ? x : null);
  return {
    avgTemp: avg(p.T2M), avgPrecip: avg(p.PRECTOTCORR),
    avgRootMoist: avg(p.GWETROOT), avgTopMoist: avg(p.GWETTOP), avgHumidity: avg(p.RH2M),
    moistSeries: series(p.GWETROOT), precipSeries: series(p.PRECTOTCORR)
  };
}

// Builds a tiny self-contained SVG line chart. values: array of numbers (nulls skipped), color: stroke hex.
function sparklineSVG(values, color, maxOverride) {
  const clean = values.map((v,i) => ({v, i})).filter(p => p.v !== null && p.v !== undefined);
  if (clean.length < 2) return '<p class="muted">Not enough data for a trend yet.</p>';
  const w = 300, h = 80, pad = 6;
  const max = maxOverride || Math.max(...clean.map(p => p.v));
  const min = Math.min(0, ...clean.map(p => p.v));
  const range = (max - min) || 1;
  const x = i => pad + (i/(values.length-1)) * (w - pad*2);
  const y = v => h - pad - ((v-min)/range) * (h - pad*2);
  const path = clean.map((p,idx) => `${idx===0 ? 'M':'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px;">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

async function fetchEvents(lat, lon) {
  try {
    const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100');
    const data = await res.json();
    return (data.events || []).find(ev => {
      const g = ev.geometry && ev.geometry[ev.geometry.length-1];
      if (!g || !g.coordinates) return false;
      const [elon, elat] = g.coordinates;
      const dist = Math.sqrt((elat-lat)**2 + (elon-lon)**2);
      return dist < 2 && /drought|wildfire|flood|storm/i.test(ev.title + ev.categories.map(c=>c.title).join(''));
    }) || null;
  } catch (e) { return null; }
}

function satPhotoUrl(lat, lon) {
  return `https://api.nasa.gov/planetary/earth/imagery?lon=${lon}&lat=${lat}&dim=0.15&api_key=${NASA_KEY}`;
}

function analyzeRisks(d) {
  return {
    droughtRisk: d.avgRootMoist < 0.3,
    waterlogRisk: d.avgRootMoist > 0.7 && d.avgPrecip > 5,
    heatStress: d.avgTemp > 33
  };
}

function pickCrops(risks, lastCrop) {
  const lastFamily = LAST_FAMILY[lastCrop];
  let candidates = Object.entries(CROPS).filter(([k,c]) => {
    if (risks.droughtRisk) return c.water === 'low' || c.water === 'medium';
    if (risks.waterlogRisk) return c.water === 'high' || c.water === 'medium';
    return true;
  });
  candidates.sort((a,b) => {
    const score = c => {
      let s = 0;
      if (lastFamily && c[1].family === lastFamily) s -= 5;
      if (lastFamily === 'cereal' && c[1].family === 'legume') s += 3;
      if (risks.droughtRisk && c[1].water === 'low') s += 2;
      return s;
    };
    return score(b) - score(a);
  });
  return {top: candidates.slice(0,4), lastFamily};
}

function buildActions(risks, lastFamily) {
  const actions = [];
  if (risks.droughtRisk) {
    actions.push('Plant drought-tough crops like cassava, sorghum, or cowpea this season.');
    actions.push("Cover the soil with dry leaves/mulch to keep water in the ground.");
  }
  if (risks.waterlogRisk) {
    actions.push("Dig small drainage channels so water doesn't sit on the field.");
    actions.push("Raise your planting beds if your crop doesn't like wet roots.");
  }
  if (risks.heatStress) actions.push('Plant early morning or late evening to protect young plants from heat.');
  if (lastFamily === 'cereal') actions.push('Plant beans or groundnut to feed the soil before your next maize/rice crop.');
  actions.push('Check this app again in 1-2 weeks — the data updates daily.');
  return actions;
}

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const AIRLINES_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat';
const AIRPORTS_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const ROUTES_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat';
const OUT_PATH = path.resolve(process.cwd(), 'electron', 'data', 'commercial-routes.json.gz');

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // ignore CR
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const PREFERRED_BY_IATA = {
  G3: { name: 'GOL Linhas Aéreas', iata: 'G3', icao: 'GLO' },
  AD: { name: 'Azul Linhas Aéreas', iata: 'AD', icao: 'AZU' },
  JJ: { name: 'LATAM Brasil', iata: 'JJ', icao: 'TAM' },
  LA: { name: 'LATAM Airlines', iata: 'LA', icao: 'LAN' },
  '2Z': { name: 'Voepass Linhas Aéreas', iata: '2Z', icao: 'PTB' },
  AR: { name: 'Aerolíneas Argentinas', iata: 'AR', icao: 'ARG' },
  AV: { name: 'Avianca', iata: 'AV', icao: 'AVA' },
  CM: { name: 'Copa Airlines', iata: 'CM', icao: 'CMP' },
  TP: { name: 'TAP Air Portugal', iata: 'TP', icao: 'TAP' },
  IB: { name: 'Iberia', iata: 'IB', icao: 'IBE' },
  AF: { name: 'Air France', iata: 'AF', icao: 'AFR' },
  KL: { name: 'KLM Royal Dutch Airlines', iata: 'KL', icao: 'KLM' },
  LH: { name: 'Lufthansa', iata: 'LH', icao: 'DLH' },
  BA: { name: 'British Airways', iata: 'BA', icao: 'BAW' },
  AA: { name: 'American Airlines', iata: 'AA', icao: 'AAL' },
  DL: { name: 'Delta Air Lines', iata: 'DL', icao: 'DAL' },
  UA: { name: 'United Airlines', iata: 'UA', icao: 'UAL' },
  AC: { name: 'Air Canada', iata: 'AC', icao: 'ACA' },
  FR: { name: 'Ryanair', iata: 'FR', icao: 'RYR' },
  U2: { name: 'easyJet', iata: 'U2', icao: 'EZY' },
  EK: { name: 'Emirates', iata: 'EK', icao: 'UAE' },
  QR: { name: 'Qatar Airways', iata: 'QR', icao: 'QTR' },
  TK: { name: 'Turkish Airlines', iata: 'TK', icao: 'THY' },
};

function cleanVal(val) {
  const s = (val || '').trim();
  return s === '\\N' || s === '-' || s === 'N/A' ? '' : s;
}

async function main() {
  console.log('Downloading OpenFlights airlines, airports & routes...');
  const [airlinesRes, airportsRes, routesRes] = await Promise.all([
    fetch(AIRLINES_URL),
    fetch(AIRPORTS_URL),
    fetch(ROUTES_URL),
  ]);

  if (!airlinesRes.ok || !airportsRes.ok || !routesRes.ok) {
    throw new Error('Failed downloading OpenFlights datasets');
  }

  const [airlinesCsv, airportsCsv, routesCsv] = await Promise.all([
    airlinesRes.text(),
    airportsRes.text(),
    routesRes.text(),
  ]);

  // 1. Parse Airlines
  // 0:id, 1:name, 2:alias, 3:iata, 4:icao, 5:callsign, 6:country, 7:active
  const airlineRows = parseCsvRows(airlinesCsv);
  const airlinesById = new Map();
  const airlinesByCode = {};

  for (const r of airlineRows) {
    if (!r || r.length < 8) continue;
    const id = cleanVal(r[0]);
    const name = cleanVal(r[1]);
    const iata = cleanVal(r[3]).toUpperCase();
    const icao = cleanVal(r[4]).toUpperCase();
    const active = cleanVal(r[7]).toUpperCase() === 'Y';
    if (!id || !name || id === '-1') continue;

    const entry = { name, ...(iata ? { iata } : {}), ...(icao ? { icao } : {}), active };
    airlinesById.set(id, entry);

    if (iata && (!airlinesByCode[iata] || active)) {
      airlinesByCode[iata] = name;
    }
    if (icao && (!airlinesByCode[icao] || active)) {
      airlinesByCode[icao] = name;
    }
  }

  for (const pref of Object.values(PREFERRED_BY_IATA)) {
    airlinesByCode[pref.iata] = pref.name;
    airlinesByCode[pref.icao] = pref.name;
  }

  // 2. Parse OpenFlights Airports (map airportId & IATA -> ICAO)
  // 0:id, 1:name, 2:city, 3:country, 4:iata, 5:icao
  const airportRows = parseCsvRows(airportsCsv);
  const icaoByAirportId = new Map();
  const icaoByIata = new Map();

  for (const r of airportRows) {
    if (!r || r.length < 6) continue;
    const id = cleanVal(r[0]);
    const iata = cleanVal(r[4]).toUpperCase();
    const icao = cleanVal(r[5]).toUpperCase();
    if (!icao || !/^[A-Z0-9]{4}$/.test(icao)) continue;

    if (id) icaoByAirportId.set(id, icao);
    if (iata) icaoByIata.set(iata, icao);
  }

  // 3. Parse Routes
  // 0:airlineCode, 1:airlineId, 2:srcCode, 3:srcId, 4:dstCode, 5:dstId, 6:codeshare, 7:stops, 8:equipment
  const routeRows = parseCsvRows(routesCsv);
  const routesMap = new Map();

  for (const r of routeRows) {
    if (!r || r.length < 9) continue;
    const stops = cleanVal(r[7]);
    if (stops && stops !== '0') continue;

    const airlineCode = cleanVal(r[0]).toUpperCase();
    const airlineId = cleanVal(r[1]);
    const srcCode = cleanVal(r[2]).toUpperCase();
    const srcId = cleanVal(r[3]);
    const dstCode = cleanVal(r[4]).toUpperCase();
    const dstId = cleanVal(r[5]);
    const codeshare = cleanVal(r[6]).toUpperCase() === 'Y';
    const equipment = cleanVal(r[8]);

    const origIcao =
      icaoByAirportId.get(srcId) ||
      (/^[A-Z0-9]{4}$/.test(srcCode) ? srcCode : icaoByIata.get(srcCode));
    const destIcao =
      icaoByAirportId.get(dstId) ||
      (/^[A-Z0-9]{4}$/.test(dstCode) ? dstCode : icaoByIata.get(dstCode));

    if (!origIcao || !destIcao || origIcao === destIcao) continue;

    const al = airlinesById.get(airlineId);
    const preferred =
      (al?.iata && PREFERRED_BY_IATA[al.iata]) ||
      (airlineCode.length === 2 && PREFERRED_BY_IATA[airlineCode]) ||
      null;

    const resolvedName = preferred?.name || al?.name || airlinesByCode[airlineCode] || airlineCode;
    if (!resolvedName) continue;

    const resolvedIata = preferred?.iata || al?.iata || (airlineCode.length === 2 ? airlineCode : undefined);
    const resolvedIcao = preferred?.icao || al?.icao || (airlineCode.length === 3 ? airlineCode : undefined);

    const pairKey = `${origIcao}-${destIcao}`;
    let list = routesMap.get(pairKey);
    if (!list) {
      list = [];
      routesMap.set(pairKey, list);
    }

    const exists = list.some(
      (item) =>
        item.airlineName === resolvedName &&
        Boolean(item.isCodeshare) === codeshare
    );
    if (!exists) {
      list.push({
        airlineName: resolvedName,
        ...(resolvedIata ? { airlineIata: resolvedIata } : {}),
        ...(resolvedIcao ? { airlineIcao: resolvedIcao } : {}),
        ...(equipment ? { equipment } : {}),
        ...(codeshare ? { isCodeshare: true } : {}),
      });
    }
  }

  const routesByPair = Object.fromEntries(routesMap.entries());
  const payload = { airlinesByCode, routesByPair };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const gz = zlib.gzipSync(JSON.stringify(payload), { level: 9 });
  fs.writeFileSync(OUT_PATH, gz);

  console.log(
    `Saved ${routesMap.size} city pairs and ${Object.keys(airlinesByCode).length} airline codes to ${OUT_PATH} (${(gz.length / 1024).toFixed(1)} KB gz)`
  );
  console.log('Sample SBGR-SBRJ:', routesByPair['SBGR-SBRJ'] || []);
  console.log('Sample KJFK-EGLL:', routesByPair['KJFK-EGLL'] || []);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

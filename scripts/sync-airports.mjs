import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const RUNWAYS_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const OUT_PATH = path.resolve(process.cwd(), 'electron', 'data', 'airports.json.gz');

const ALLOWED_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);
const TYPE_RANK = { large_airport: 3, medium_airport: 2, small_airport: 1 };
const PAVED_PATTERN = /(ASP|CON|PEM|BIT|TAR|PAV|MAC)/i;

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

function indexHeader(headerRow) {
  const map = {};
  headerRow.forEach((name, idx) => {
    map[name.trim()] = idx;
  });
  return map;
}

function pickIcao(row, cols) {
  const icao = (row[cols.icao_code] || '').trim().toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(icao)) return icao;

  const gps = (row[cols.gps_code] || '').trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(gps)) return gps;

  const ident = (row[cols.ident] || '').trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(ident)) return ident;

  return null;
}

async function main() {
  console.log('Downloading OurAirports CSVs...');
  const [airportsRes, runwaysRes] = await Promise.all([
    fetch(AIRPORTS_URL),
    fetch(RUNWAYS_URL),
  ]);

  if (!airportsRes.ok || !runwaysRes.ok) {
    throw new Error(`Failed download: airports=${airportsRes.status}, runways=${runwaysRes.status}`);
  }

  const [airportsCsv, runwaysCsv] = await Promise.all([
    airportsRes.text(),
    runwaysRes.text(),
  ]);

  console.log('Parsing runways...');
  const runwayRows = parseCsvRows(runwaysCsv);
  const rCols = indexHeader(runwayRows[0]);
  const runwayStatsByRef = new Map();

  for (let i = 1; i < runwayRows.length; i++) {
    const r = runwayRows[i];
    if (!r || r.length < 6) continue;
    if ((r[rCols.closed] || '').trim() === '1') continue;

    const ref = (r[rCols.airport_ref] || '').trim();
    const lengthFt = Number.parseInt(r[rCols.length_ft] || '0', 10);
    if (!ref || !Number.isFinite(lengthFt) || lengthFt <= 0) continue;

    const surface = (r[rCols.surface] || '').trim();
    const isPaved = PAVED_PATTERN.test(surface);

    let entry = runwayStatsByRef.get(ref);
    if (!entry) {
      entry = { maxRunwayFt: 0, maxPavedRunwayFt: 0, hasPavedRunway: false };
      runwayStatsByRef.set(ref, entry);
    }
    if (lengthFt > entry.maxRunwayFt) {
      entry.maxRunwayFt = lengthFt;
    }
    if (isPaved) {
      entry.hasPavedRunway = true;
      if (lengthFt > entry.maxPavedRunwayFt) {
        entry.maxPavedRunwayFt = lengthFt;
      }
    }
  }

  console.log('Parsing airports...');
  const airportRows = parseCsvRows(airportsCsv);
  const aCols = indexHeader(airportRows[0]);
  const byIcao = new Map();

  for (let i = 1; i < airportRows.length; i++) {
    const a = airportRows[i];
    if (!a || a.length < 12) continue;

    const type = (a[aCols.type] || '').trim();
    if (!ALLOWED_TYPES.has(type)) continue;

    const icao = pickIcao(a, aCols);
    if (!icao) continue;

    const lat = Number.parseFloat(a[aCols.latitude_deg] || '');
    const lon = Number.parseFloat(a[aCols.longitude_deg] || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const ref = (a[aCols.id] || '').trim();
    const rwy = runwayStatsByRef.get(ref);
    if (!rwy || rwy.maxRunwayFt <= 0) continue;

    const elevParsed = Number.parseInt(a[aCols.elevation_ft] || '0', 10);
    const elevationFt = Number.isFinite(elevParsed) ? elevParsed : 0;

    const iata = (a[aCols.iata_code] || '').trim().toUpperCase() || undefined;
    const name = (a[aCols.name] || '').trim();
    const city = (a[aCols.municipality] || '').trim() || name;
    const country = (a[aCols.iso_country] || '').trim().toUpperCase();
    const continent = (a[aCols.continent] || '').trim().toUpperCase();

    const record = {
      icao,
      ...(iata ? { iata } : {}),
      name,
      city,
      country,
      continent,
      type,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      elevationFt,
      maxRunwayFt: rwy.hasPavedRunway ? rwy.maxPavedRunwayFt : rwy.maxRunwayFt,
      hasPavedRunway: rwy.hasPavedRunway,
    };

    const existing = byIcao.get(icao);
    if (!existing || TYPE_RANK[type] > TYPE_RANK[existing.type]) {
      byIcao.set(icao, record);
    }
  }

  const airports = Array.from(byIcao.values()).sort((x, y) => x.icao.localeCompare(y.icao));
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const gz = zlib.gzipSync(JSON.stringify(airports), { level: 9 });
  fs.writeFileSync(OUT_PATH, gz);

  const counts = { large_airport: 0, medium_airport: 0, small_airport: 0 };
  for (const ap of airports) counts[ap.type]++;

  console.log(`Saved ${airports.length} airports to ${OUT_PATH} (${(gz.length / 1024).toFixed(1)} KB gz)`);
  console.log('Breakdown:', counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

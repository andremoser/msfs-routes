import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DOC8643_URL =
  'https://raw.githubusercontent.com/gabrielmacedoanac/flat-data-anac/main/aeronaves-icao-doc8643.csv';
const PRESETS_PATH = path.resolve(process.cwd(), 'electron', 'data', 'aircraft-presets.json');
const OUT_PATH = path.resolve(process.cwd(), 'electron', 'data', 'aircraft.json.gz');

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

function cleanStr(val) {
  return (val || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function toTitleCaseManufacturer(mfr) {
  const upper = mfr.toUpperCase();
  const acronyms = new Map([
    ['AIRBUS', 'Airbus'],
    ['BOEING', 'Boeing'],
    ['EMBRAER', 'Embraer'],
    ['CESSNA', 'Cessna'],
    ['PIPER', 'Piper'],
    ['BEECHCRAFT', 'Beechcraft'],
    ['BEECH', 'Beechcraft'],
    ['PILATUS', 'Pilatus'],
    ['BOMBARDIER', 'Bombardier'],
    ['MCDONNELL DOUGLAS', 'McDonnell Douglas'],
    ['DE HAVILLAND CANADA', 'De Havilland Canada'],
    ['DE HAVILLAND', 'De Havilland'],
    ['GULFSTREAM', 'Gulfstream'],
    ['DASSAULT', 'Dassault'],
    ['CIRRUS', 'Cirrus'],
    ['DIAMOND', 'Diamond'],
    ['MOONEY', 'Mooney'],
    ['LOCKHEED', 'Lockheed'],
    ['LEARJET', 'Learjet'],
    ['FOKKER', 'Fokker'],
    ['SAAB', 'Saab'],
    ['SOCATA', 'Socata'],
    ['DAHER', 'Daher'],
    ['ATR', 'ATR'],
    ['ANTONOV', 'Antonov'],
    ['DOUGLAS', 'Douglas'],
    ['ROBIN', 'Robin'],
    ['TECNAM', 'Tecnam'],
    ['RAYTHEON', 'Raytheon'],
    ['HAWKER', 'Hawker'],
    ['CANADAIR', 'Canadair'],
    ['FAIRCHILD', 'Fairchild'],
    ['DORNIER', 'Dornier'],
    ['SHORTS', 'Shorts'],
    ['PIAGGIO', 'Piaggio'],
    ['HONDA', 'Honda'],
    ['VANS', "Van's"],
    ["VAN'S", "Van's"],
    ['CUBCRAFTERS', 'CubCrafters'],
    ['MAULE', 'Maule'],
    ['CHAMPION', 'Champion'],
    ['AMERICAN CHAMPION', 'American Champion'],
    ['EXTRA', 'Extra'],
    ['ZLIN', 'Zlin'],
    ['AVIAT', 'Aviat'],
    ['QUEST', 'Quest'],
    ['PACIFIC AEROSPACE', 'Pacific Aerospace'],
    ['VULCANAIR', 'Vulcanair'],
    ['PARTENAVIA', 'Partenavia'],
    ['PIPER-MALIBU', 'Piper'],
    ['AERO COMMANDER', 'Aero Commander'],
    ['ROCKWELL', 'Rockwell'],
    ['SUKHOI', 'Sukhoi'],
    ['COMAC', 'COMAC'],
    ['ILYUSHIN', 'Ilyushin'],
    ['TUPOLEV', 'Tupolev'],
    ['YAKOVLEV', 'Yakovlev'],
    ['MITSUBISHI', 'Mitsubishi'],
    ['NAMC', 'NAMC'],
    ['NEIVA', 'Neiva'],
    ['AERO BOERO', 'Aero Boero'],
    ['PAULISTINHA', 'Paulistinha'],
    ['AEROMOT', 'Aeromot'],
  ]);

  if (acronyms.has(upper)) return acronyms.get(upper);
  return mfr
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function inferDefaults(engineType, engineCount, wtc, description) {
  const eng = engineType.toLowerCase();
  const desc = description.toLowerCase();
  const count = Number.parseInt(engineCount, 10) || 1;
  const weight = wtc.toUpperCase();
  const isWaterOrBush = desc.includes('seaplane') || desc.includes('amphibian');

  if (eng.includes('jet')) {
    if (weight === 'H' || weight === 'J') {
      return {
        category: 'Widebody',
        cruiseKtas: 480,
        maxRangeNm: 6500,
        minRunwayFt: 8800,
        requiresPaved: true,
        typicalCruiseAltFt: 38000,
      };
    }
    if (weight === 'M') {
      return {
        category: 'Narrowbody',
        cruiseKtas: 450,
        maxRangeNm: 2600,
        minRunwayFt: 6000,
        requiresPaved: true,
        typicalCruiseAltFt: 36000,
      };
    }
    return {
      category: 'Business Jet',
      cruiseKtas: 420,
      maxRangeNm: 1800,
      minRunwayFt: 3500,
      requiresPaved: true,
      typicalCruiseAltFt: 38000,
    };
  }

  if (eng.includes('turboprop')) {
    if (weight === 'H') {
      return {
        category: 'Turboprop',
        cruiseKtas: 360,
        maxRangeNm: 3200,
        minRunwayFt: 4500,
        requiresPaved: false,
        typicalCruiseAltFt: 28000,
      };
    }
    if (weight === 'M') {
      return {
        category: 'Regional',
        cruiseKtas: 295,
        maxRangeNm: 1300,
        minRunwayFt: 4200,
        requiresPaved: true,
        typicalCruiseAltFt: 23000,
      };
    }
    return {
      category: isWaterOrBush ? 'Utility / Bush' : 'Turboprop',
      cruiseKtas: count >= 2 ? 265 : 230,
      maxRangeNm: count >= 2 ? 1350 : 1200,
      minRunwayFt: count >= 2 ? 2800 : 2000,
      requiresPaved: count >= 2 && !isWaterOrBush,
      typicalCruiseAltFt: count >= 2 ? 24000 : 20000,
    };
  }

  if (eng.includes('electric')) {
    return {
      category: 'Piston',
      cruiseKtas: 110,
      maxRangeNm: 180,
      minRunwayFt: 1500,
      requiresPaved: false,
      typicalCruiseAltFt: 5500,
    };
  }

  // Piston / default
  if (weight === 'M') {
    return {
      category: 'Piston',
      cruiseKtas: 210,
      maxRangeNm: 1800,
      minRunwayFt: 3800,
      requiresPaved: true,
      typicalCruiseAltFt: 14000,
    };
  }

  if (count >= 2) {
    return {
      category: isWaterOrBush ? 'Utility / Bush' : 'Piston',
      cruiseKtas: 185,
      maxRangeNm: 1050,
      minRunwayFt: 2300,
      requiresPaved: !isWaterOrBush,
      typicalCruiseAltFt: 11500,
    };
  }

  return {
    category: isWaterOrBush ? 'Utility / Bush' : 'Piston',
    cruiseKtas: 135,
    maxRangeNm: 680,
    minRunwayFt: 1600,
    requiresPaved: false,
    typicalCruiseAltFt: 8500,
  };
}

async function main() {
  const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf-8'));
  const presetMap = new Map(presets.map((p) => [p.icao.toUpperCase(), p]));

  console.log('Downloading official ICAO Doc 8643 dataset...');
  const res = await fetch(DOC8643_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading Doc 8643 CSV`);
  }
  const csv = await res.text();
  const rows = parseCsvRows(csv);

  // Cols: 0=ID, 1=Manufacturer, 2=Model, 3=Type Designator, 4=Description, 5=Engine Type, 6=Engine Count, 7=WTC
  const grouped = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 8) continue;

    const mfrRaw = cleanStr(r[1]);
    const modelRaw = cleanStr(r[2]);
    const icao = cleanStr(r[3]).toUpperCase();
    const desc = cleanStr(r[4]);
    const engType = cleanStr(r[5]);
    const engCount = cleanStr(r[6]);
    const wtc = cleanStr(r[7]);

    if (!icao || !/^[A-Z0-9]{2,4}$/.test(icao)) continue;
    // Focus on fixed-wing aircraft (skip helicopters/gyrocopters/tiltrotors if desired, or keep LandPlane/SeaPlane/Amphibian)
    const descLower = desc.toLowerCase();
    if (
      !descLower.includes('landplane') &&
      !descLower.includes('seaplane') &&
      !descLower.includes('amphibian')
    ) {
      continue;
    }

    let entry = grouped.get(icao);
    if (!entry) {
      entry = {
        icao,
        mfr: toTitleCaseManufacturer(mfrRaw),
        models: [],
        desc,
        engType,
        engCount,
        wtc,
      };
      grouped.set(icao, entry);
    }

    if (modelRaw && !entry.models.includes(modelRaw)) {
      entry.models.push(modelRaw);
    }
  }

  const finalList = [];

  // First add all curated presets (enriched with Doc 8643 aliases if available)
  for (const preset of presets) {
    const docEntry = grouped.get(preset.icao);
    const aliases = docEntry
      ? docEntry.models
          .filter((m) => !preset.name.toUpperCase().includes(m.toUpperCase()))
          .slice(0, 6)
      : [];

    finalList.push({
      ...preset,
      isPreset: true,
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }

  // Then add all remaining ICAO Doc 8643 fixed-wing aircraft
  for (const [icao, entry] of grouped.entries()) {
    if (presetMap.has(icao)) continue;

    // Pick descriptive primary model name (avoid bare numbers like "400" when "400 Corvalis TT" exists)
    const sortedModels = [...entry.models].sort((a, b) => {
      const aHasLetters = /[a-zA-Z]{2,}/.test(a) ? 1 : 0;
      const bHasLetters = /[a-zA-Z]{2,}/.test(b) ? 1 : 0;
      if (aHasLetters !== bHasLetters) return bHasLetters - aHasLetters;
      const aScore = a.length >= 6 && a.length <= 28 ? 1 : 0;
      const bScore = b.length >= 6 && b.length <= 28 ? 1 : 0;
      if (aScore !== bScore) return bScore - aScore;
      return a.length - b.length;
    });
    const primaryModel = sortedModels[0] || icao;
    const aliases = sortedModels.slice(1, 8);
    const defaults = inferDefaults(entry.engType, entry.engCount, entry.wtc, entry.desc);

    finalList.push({
      icao,
      name: `${entry.mfr} ${primaryModel}`.trim(),
      ...defaults,
      isPreset: false,
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }

  // Sort: curated MSFS presets first (sorted by name), then rest alphabetically by name
  finalList.sort((a, b) => {
    if (Boolean(a.isPreset) !== Boolean(b.isPreset)) {
      return a.isPreset ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const gz = zlib.gzipSync(JSON.stringify(finalList), { level: 9 });
  fs.writeFileSync(OUT_PATH, gz);

  console.log(`Saved ${finalList.length} unique ICAO aircraft to ${OUT_PATH} (${(gz.length / 1024).toFixed(1)} KB gz)`);
  console.log('Corvalis matches:', finalList.filter((a) => /corvalis/i.test(a.name) || (a.aliases || []).some((x) => /corvalis/i.test(x))).map((a) => `${a.icao}:${a.name}`));
  console.log('Bandeirante matches:', finalList.filter((a) => /bandeirante/i.test(a.name) || (a.aliases || []).some((x) => /bandeirante/i.test(x))).map((a) => `${a.icao}:${a.name}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

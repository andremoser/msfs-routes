import { AirportRecord, MetarCloud, MetarInfo } from '../shared/types';
import { haversineNm } from './route-engine';

const METAR_ENDPOINT = 'https://aviationweather.gov/api/data/metar';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

interface AviationWeatherMetarRaw {
  icaoId?: string;
  reportTime?: string;
  obsTime?: number;
  temp?: number | null;
  dewp?: number | null;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: string | number | null;
  altim?: number | null;
  rawOb?: string;
  fltCat?: string;
  clouds?: Array<{ cover?: string; base?: number | null }>;
}

interface CacheEntry {
  expiresAt: number;
  data: MetarInfo;
}

const metarCache = new Map<string, CacheEntry>();

function mapRawToMetarInfo(
  rawItem: AviationWeatherMetarRaw,
  requestedIcao: string,
  isNearbyFallback = false,
  distanceFromAirportNm?: number
): MetarInfo {
  const stationIcao = (rawItem.icaoId || requestedIcao).toUpperCase();
  const clouds: MetarCloud[] = Array.isArray(rawItem.clouds)
    ? rawItem.clouds
        .filter((c) => c && c.cover)
        .map((c) => ({
          cover: String(c.cover).toUpperCase(),
          ...(typeof c.base === 'number' ? { baseFt: c.base } : {}),
        }))
    : [];

  const altimHpa =
    typeof rawItem.altim === 'number' && Number.isFinite(rawItem.altim)
      ? Math.round(rawItem.altim)
      : null;
  const altimInHg =
    typeof rawItem.altim === 'number' && Number.isFinite(rawItem.altim)
      ? Number((rawItem.altim * 0.02953).toFixed(2))
      : null;

  const wdir =
    rawItem.wdir === 'VRB'
      ? 'VRB'
      : typeof rawItem.wdir === 'number' && Number.isFinite(rawItem.wdir)
        ? rawItem.wdir
        : null;

  let obsTimeIso = rawItem.reportTime;
  if (!obsTimeIso && typeof rawItem.obsTime === 'number') {
    obsTimeIso = new Date(rawItem.obsTime * 1000).toISOString();
  }

  return {
    stationIcao,
    requestedIcao,
    isNearbyFallback,
    ...(distanceFromAirportNm !== undefined ? { distanceFromAirportNm } : {}),
    raw: rawItem.rawOb || `${stationIcao} (sem texto bruto)`,
    flightCategory: rawItem.fltCat || undefined,
    obsTime: obsTimeIso,
    tempC: typeof rawItem.temp === 'number' ? rawItem.temp : null,
    dewpointC: typeof rawItem.dewp === 'number' ? rawItem.dewp : null,
    windDirDeg: wdir,
    windSpeedKt: typeof rawItem.wspd === 'number' ? rawItem.wspd : null,
    windGustKt: typeof rawItem.wgst === 'number' ? rawItem.wgst : null,
    visibility: rawItem.visib !== undefined && rawItem.visib !== null ? String(rawItem.visib) : null,
    altimeterHpa: altimHpa,
    altimeterInHg: altimInHg,
    clouds,
  };
}

async function fetchRawMetars(icaos: string[]): Promise<Map<string, AviationWeatherMetarRaw>> {
  const result = new Map<string, AviationWeatherMetarRaw>();
  if (icaos.length === 0) return result;

  const url = `${METAR_ENDPOINT}?ids=${encodeURIComponent(icaos.join(','))}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AeroRoute-MSFS/1.0',
        Accept: 'application/json',
      },
    });

    if (response.status === 204) {
      return result;
    }

    if (!response.ok) {
      throw new Error(`AviationWeather HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) return result;

    const payload = JSON.parse(text) as AviationWeatherMetarRaw[];
    if (!Array.isArray(payload)) return result;

    for (const item of payload) {
      const id = item.icaoId?.toUpperCase();
      if (id && !result.has(id)) {
        result.set(id, item);
      }
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function getMetarsForIcaos(
  requestedIcaos: string[],
  airports: AirportRecord[]
): Promise<Record<string, MetarInfo>> {
  const normalized = Array.from(
    new Set(requestedIcaos.map((s) => s.trim().toUpperCase()).filter(Boolean))
  );
  const now = Date.now();
  const output: Record<string, MetarInfo> = {};
  const toFetch: string[] = [];

  for (const icao of normalized) {
    const cached = metarCache.get(icao);
    if (cached && cached.expiresAt > now) {
      output[icao] = cached.data;
    } else {
      toFetch.push(icao);
    }
  }

  if (toFetch.length === 0) {
    return output;
  }

  try {
    const directMap = await fetchRawMetars(toFetch);
    const missing: string[] = [];

    for (const icao of toFetch) {
      const rawItem = directMap.get(icao);
      if (rawItem) {
        const info = mapRawToMetarInfo(rawItem, icao, false);
        metarCache.set(icao, { expiresAt: now + CACHE_TTL_MS, data: info });
        output[icao] = info;
      } else {
        missing.push(icao);
      }
    }

    // Attempt nearby station fallback for airports without their own METAR station
    if (missing.length > 0) {
      const airportByIcao = new Map(airports.map((a) => [a.icao, a]));
      const nearbyCandidatesPerTarget = new Map<string, Array<{ icao: string; distNm: number }>>();
      const fallbackBatch = new Set<string>();

      for (const targetIcao of missing) {
        const target = airportByIcao.get(targetIcao);
        if (!target) continue;

        const nearby = airports
          .filter(
            (ap) =>
              ap.icao !== targetIcao &&
              ap.type !== 'small_airport' &&
              Math.abs(ap.lat - target.lat) * 60 <= 85
          )
          .map((ap) => ({
            icao: ap.icao,
            distNm: Math.round(haversineNm(target.lat, target.lon, ap.lat, ap.lon)),
          }))
          .filter((x) => x.distNm <= 80)
          .sort((a, b) => a.distNm - b.distNm)
          .slice(0, 5);

        nearbyCandidatesPerTarget.set(targetIcao, nearby);
        for (const n of nearby) fallbackBatch.add(n.icao);
      }

      const fallbackRawMap =
        fallbackBatch.size > 0
          ? await fetchRawMetars(Array.from(fallbackBatch).slice(0, 20))
          : new Map<string, AviationWeatherMetarRaw>();

      for (const targetIcao of missing) {
        const nearbyList = nearbyCandidatesPerTarget.get(targetIcao) || [];
        let matchedInfo: MetarInfo | null = null;

        for (const cand of nearbyList) {
          const rawItem = fallbackRawMap.get(cand.icao);
          if (rawItem) {
            matchedInfo = mapRawToMetarInfo(rawItem, targetIcao, true, cand.distNm);
            break;
          }
        }

        const finalInfo: MetarInfo = matchedInfo ?? {
          stationIcao: targetIcao,
          requestedIcao: targetIcao,
          isNearbyFallback: false,
          raw: '',
          clouds: [],
          unavailableReason: 'Sem METAR reportado para este aeródromo ou região próxima.',
        };

        metarCache.set(targetIcao, {
          expiresAt: now + (matchedInfo ? CACHE_TTL_MS : 3 * 60 * 1000),
          data: finalInfo,
        });
        output[targetIcao] = finalInfo;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar METAR';
    for (const icao of toFetch) {
      if (!output[icao]) {
        output[icao] = {
          stationIcao: icao,
          requestedIcao: icao,
          isNearbyFallback: false,
          raw: '',
          clouds: [],
          unavailableReason: `Falha ao buscar METAR online (${message}).`,
        };
      }
    }
  }

  return output;
}

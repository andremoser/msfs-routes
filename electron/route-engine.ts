import {
  AircraftProfile,
  AirportRecord,
  AirportSize,
  RouteSearchParams,
  RouteSearchResult,
  SuggestedRoute,
} from '../shared/types';
import { matchesRegion } from './regions';

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const SIZE_RANK: Record<AirportSize, number> = {
  large_airport: 3,
  medium_airport: 2,
  small_airport: 1,
};

export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const rLat1 = lat1 * DEG_TO_RAD;
  const rLat2 = lat2 * DEG_TO_RAD;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_NM * c;
}

export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rLat1 = lat1 * DEG_TO_RAD;
  const rLat2 = lat2 * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;

  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * RAD_TO_DEG;
  return Math.round((brng + 360) % 360);
}

export function resolveAircraftProfile(
  aircraftList: AircraftProfile[],
  icaoInput: string,
  minRunwayFt: number,
  requiresPaved: boolean
): AircraftProfile {
  const normalized = icaoInput.trim().toUpperCase();
  const found = aircraftList.find((a) => a.icao === normalized);
  if (found) {
    return found;
  }

  return {
    icao: normalized || 'CSTM',
    name: `${normalized || 'Custom'} (Personalizada)`,
    category: 'Turboprop',
    cruiseKtas: 260,
    maxRangeNm: 1800,
    minRunwayFt,
    requiresPaved,
    typicalCruiseAltFt: 24000,
  };
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function estimateFlightMinutes(distanceNm: number, cruiseKtas: number): number {
  const speed = Math.max(80, cruiseKtas);
  return Math.max(15, Math.round((distanceNm / speed) * 60 + 12));
}

export function searchAirportsList(
  airports: AirportRecord[],
  query: string,
  regionId?: string,
  limit = 25
): AirportRecord[] {
  const q = query.trim().toUpperCase();
  const matches: AirportRecord[] = [];

  for (const ap of airports) {
    if (regionId && regionId !== 'ALL' && !matchesRegion(ap, regionId)) {
      continue;
    }
    if (!q) {
      matches.push(ap);
      continue;
    }
    if (
      ap.icao.includes(q) ||
      (ap.iata && ap.iata.includes(q)) ||
      ap.city.toUpperCase().includes(q) ||
      ap.name.toUpperCase().includes(q)
    ) {
      matches.push(ap);
    }
  }

  matches.sort((a, b) => {
    if (q) {
      const aExact = a.icao === q || a.iata === q ? 1 : 0;
      const bExact = b.icao === q || b.iata === q ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      const aStarts = a.icao.startsWith(q) ? 1 : 0;
      const bStarts = b.icao.startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
    }

    const rankDiff = SIZE_RANK[b.type] - SIZE_RANK[a.type];
    if (rankDiff !== 0) return rankDiff;
    return b.maxRunwayFt - a.maxRunwayFt;
  });

  return matches.slice(0, limit);
}

export function findMatchingRoutes(
  airports: AirportRecord[],
  aircraftList: AircraftProfile[],
  params: RouteSearchParams
): RouteSearchResult {
  const aircraft = resolveAircraftProfile(
    aircraftList,
    params.aircraftIcao,
    params.minRunwayFt,
    params.requiresPaved
  );

  let warning: string | undefined;
  let effectiveMaxDistanceNm = Math.max(10, params.maxDistanceNm);
  const minDistanceNm = Math.max(0, Math.min(params.minDistanceNm, effectiveMaxDistanceNm));

  if (params.respectAircraftRange && effectiveMaxDistanceNm > aircraft.maxRangeNm) {
    effectiveMaxDistanceNm = aircraft.maxRangeNm;
    warning = `Distância máxima ajustada para ${aircraft.maxRangeNm} NM (alcance máximo do ${aircraft.icao}).`;
  }

  const allowedSizes = new Set<AirportSize>(
    params.airportSizes.length > 0
      ? params.airportSizes
      : ['large_airport', 'medium_airport', 'small_airport']
  );

  const candidates = airports.filter((ap) => {
    if (!matchesRegion(ap, params.regionId)) return false;
    if (!allowedSizes.has(ap.type)) return false;
    if (ap.maxRunwayFt < params.minRunwayFt) return false;
    if (params.requiresPaved && !ap.hasPavedRunway) return false;
    return true;
  });

  const limit = Math.max(1, Math.min(params.limit || 30, 100));
  const originCode = params.originIcao?.trim().toUpperCase();

  if (originCode) {
    const origin = airports.find((ap) => ap.icao === originCode);
    if (!origin) {
      return {
        routes: [],
        candidateAirportsCount: candidates.length,
        totalMatchingPairs: 0,
        effectiveMaxDistanceNm,
        warning: `Aeroporto de origem "${originCode}" não encontrado na base.`,
      };
    }

    if (origin.maxRunwayFt < params.minRunwayFt || (params.requiresPaved && !origin.hasPavedRunway)) {
      const rwyWarn = `Atenção: a pista de ${origin.icao} (${origin.maxRunwayFt} ft${
        origin.hasPavedRunway ? '' : ', não pavimentada'
      }) está abaixo do requisito selecionado (${params.minRunwayFt} ft).`;
      warning = warning ? `${warning} ${rwyWarn}` : rwyWarn;
    }

    const matched: SuggestedRoute[] = [];
    for (const dest of candidates) {
      if (dest.icao === origin.icao) continue;
      if (Math.abs(origin.lat - dest.lat) * 60 > effectiveMaxDistanceNm) continue;

      const dist = Math.round(haversineNm(origin.lat, origin.lon, dest.lat, dest.lon));
      if (dist < minDistanceNm || dist > effectiveMaxDistanceNm) continue;

      matched.push({
        id: `${origin.icao}-${dest.icao}`,
        origin,
        destination: dest,
        distanceNm: dist,
        bearingDeg: initialBearingDeg(origin.lat, origin.lon, dest.lat, dest.lon),
        estimatedMinutes: estimateFlightMinutes(dist, aircraft.cruiseKtas),
        aircraft,
      });
    }

    const sorted = sortRoutes(matched, params.sortBy);
    return {
      routes: sorted.slice(0, limit),
      candidateAirportsCount: candidates.length,
      totalMatchingPairs: matched.length,
      effectiveMaxDistanceNm,
      warning,
    };
  }

  // Region-wide discovery mode (pairs within region)
  const pool = [...candidates];
  if (params.sortBy === 'random') {
    shuffleInPlace(pool);
  } else if (params.sortBy === 'hub_priority') {
    pool.sort((a, b) => SIZE_RANK[b.type] - SIZE_RANK[a.type] || b.maxRunwayFt - a.maxRunwayFt);
  }

  // Cap search pool for huge global queries so UI stays sub-second
  const maxPoolScan = params.sortBy === 'random' ? Math.min(pool.length, 450) : Math.min(pool.length, 600);
  const scanPool = pool.slice(0, maxPoolScan);
  const collected: SuggestedRoute[] = [];
  const maxCollected = params.sortBy === 'random' ? limit * 12 : limit * 8;

  for (let i = 0; i < scanPool.length; i++) {
    const a = scanPool[i];
    for (let j = i + 1; j < scanPool.length; j++) {
      const b = scanPool[j];
      if (Math.abs(a.lat - b.lat) * 60 > effectiveMaxDistanceNm) continue;

      const dist = Math.round(haversineNm(a.lat, a.lon, b.lat, b.lon));
      if (dist < minDistanceNm || dist > effectiveMaxDistanceNm) continue;

      // Randomly orient A->B or B->A in random mode for variety
      const swap = params.sortBy === 'random' && Math.random() < 0.5;
      const origin = swap ? b : a;
      const destination = swap ? a : b;

      collected.push({
        id: `${origin.icao}-${destination.icao}`,
        origin,
        destination,
        distanceNm: dist,
        bearingDeg: initialBearingDeg(origin.lat, origin.lon, destination.lat, destination.lon),
        estimatedMinutes: estimateFlightMinutes(dist, aircraft.cruiseKtas),
        aircraft,
      });

      if (collected.length >= maxCollected && params.sortBy === 'random') {
        break;
      }
    }
    if (collected.length >= maxCollected && params.sortBy === 'random') {
      break;
    }
  }

  const ordered = sortRoutes(collected, params.sortBy);

  // Enforce diversity so the user doesn't get 20 routes from the same origin
  const diversified: SuggestedRoute[] = [];
  const originCounts = new Map<string, number>();
  const maxPerOrigin = params.sortBy === 'random' ? 2 : 4;

  for (const route of ordered) {
    const count = originCounts.get(route.origin.icao) ?? 0;
    if (count >= maxPerOrigin) continue;
    originCounts.set(route.origin.icao, count + 1);
    diversified.push(route);
    if (diversified.length >= limit) break;
  }

  // Top up if diversity filter left fewer than limit
  if (diversified.length < limit && ordered.length > diversified.length) {
    const seen = new Set(diversified.map((r) => r.id));
    for (const route of ordered) {
      if (seen.has(route.id)) continue;
      diversified.push(route);
      if (diversified.length >= limit) break;
    }
  }

  return {
    routes: diversified,
    candidateAirportsCount: candidates.length,
    totalMatchingPairs: collected.length,
    effectiveMaxDistanceNm,
    warning,
  };
}

function sortRoutes(routes: SuggestedRoute[], sortBy: RouteSearchParams['sortBy']): SuggestedRoute[] {
  const copy = [...routes];
  switch (sortBy) {
    case 'distance_asc':
      return copy.sort((a, b) => a.distanceNm - b.distanceNm);
    case 'distance_desc':
      return copy.sort((a, b) => b.distanceNm - a.distanceNm);
    case 'hub_priority':
      return copy.sort((a, b) => {
        const scoreA = SIZE_RANK[a.origin.type] + SIZE_RANK[a.destination.type];
        const scoreB = SIZE_RANK[b.origin.type] + SIZE_RANK[b.destination.type];
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.destination.maxRunwayFt - a.destination.maxRunwayFt;
      });
    case 'random':
    default:
      return shuffleInPlace(copy);
  }
}

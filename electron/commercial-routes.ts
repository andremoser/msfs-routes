import {
  ApiSettings,
  CommercialFlightItem,
  CommercialRouteLookup,
} from '../shared/types';

export interface CommercialRoutesDataset {
  airlinesByCode: Record<string, string>;
  routesByPair: Record<string, CommercialFlightItem[]>;
}

interface CacheEntry {
  expiresAt: number;
  flights: CommercialFlightItem[];
  providerLabel: string;
  note?: string;
}

const LIVE_CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9000;
const liveCache = new Map<string, CacheEntry>();

function formatTimeShort(val?: string | null): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  const match = trimmed.match(/(\d{2}:\d{2})/);
  return match ? match[1] : trimmed;
}

function resolveAirlineName(
  airlinesByCode: Record<string, string>,
  iata?: string | null,
  icao?: string | null,
  explicitName?: string | null
): string {
  if (explicitName && explicitName.trim()) return explicitName.trim();
  const iataUpper = iata?.trim().toUpperCase();
  const icaoUpper = icao?.trim().toUpperCase();
  if (iataUpper && airlinesByCode[iataUpper]) return airlinesByCode[iataUpper];
  if (icaoUpper && airlinesByCode[icaoUpper]) return airlinesByCode[icaoUpper];
  return icaoUpper || iataUpper || 'Companhia Aérea';
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AeroRoute-MSFS/1.0',
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON
    }
    if (!res.ok) {
      const errObj = json as { error?: { message?: string } | string } | null;
      const detail =
        typeof errObj?.error === 'string'
          ? errObj.error
          : errObj?.error?.message || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

interface AirLabsItem {
  airline_iata?: string;
  airline_icao?: string;
  flight_iata?: string;
  flight_icao?: string;
  flight_number?: string;
  cs_flight_iata?: string;
  dep_time?: string;
  arr_time?: string;
  status?: string;
  aircraft_icao?: string;
}

async function queryAirLabs(
  airlinesByCode: Record<string, string>,
  originIcao: string,
  destIcao: string,
  originIata: string | undefined,
  destIata: string | undefined,
  apiKey: string
): Promise<{ flights: CommercialFlightItem[]; providerLabel: string; note?: string }> {
  const queryEndpoint = async (endpoint: 'schedules' | 'routes', useIata: boolean) => {
    const params = new URLSearchParams({ api_key: apiKey });
    if (useIata && originIata && destIata) {
      params.set('dep_iata', originIata);
      params.set('arr_iata', destIata);
    } else {
      params.set('dep_icao', originIcao);
      params.set('arr_icao', destIcao);
    }

    const url = `https://airlabs.co/api/v9/${endpoint}?${params.toString()}`;
    const data = (await fetchJsonWithTimeout(url)) as {
      error?: { message?: string; code?: string };
      response?: AirLabsItem[];
    };

    if (data?.error) {
      throw new Error(data.error.message || data.error.code || 'Erro na API AirLabs');
    }

    return Array.isArray(data?.response) ? data.response : [];
  };

  let rawItems = await queryEndpoint('schedules', false);
  let usedMethod = 'AirLabs Schedules (ao vivo)';

  if (rawItems.length === 0 && originIata && destIata) {
    rawItems = await queryEndpoint('schedules', true);
  }

  // If no scheduled flights in the next ~10h window, try /routes (if permitted on the user's plan)
  if (rawItems.length === 0) {
    try {
      rawItems = await queryEndpoint('routes', Boolean(originIata && destIata));
      if (rawItems.length > 0) {
        usedMethod = 'AirLabs Routes (grade regular)';
      }
    } catch {
      // /routes may be restricted on free tier; ignore gracefully when /schedules already worked
    }
  }

  const seen = new Set<string>();
  const flights: CommercialFlightItem[] = [];

  for (const item of rawItems) {
    const flightNumber = item.flight_iata || item.flight_icao || item.flight_number;
    const key = `${flightNumber || item.airline_iata || item.airline_icao}-${item.dep_time || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    flights.push({
      airlineName: resolveAirlineName(airlinesByCode, item.airline_iata, item.airline_icao),
      airlineIata: item.airline_iata || undefined,
      airlineIcao: item.airline_icao || undefined,
      flightNumber: item.flight_iata || (item.flight_number ? `${item.airline_iata || ''}${item.flight_number}` : undefined),
      flightIcao: item.flight_icao || undefined,
      depTime: formatTimeShort(item.dep_time),
      arrTime: formatTimeShort(item.arr_time),
      status: item.status || undefined,
      equipment: item.aircraft_icao || undefined,
      isCodeshare: Boolean(item.cs_flight_iata),
    });
  }

  flights.sort((a, b) => {
    if (Boolean(a.isCodeshare) !== Boolean(b.isCodeshare)) {
      return a.isCodeshare ? 1 : -1;
    }
    return (a.depTime || '').localeCompare(b.depTime || '');
  });

  return {
    flights: flights.slice(0, 30),
    providerLabel: usedMethod,
    note:
      flights.length === 0
        ? 'Nenhum voo comercial programado encontrado na janela atual da AirLabs para esta rota.'
        : undefined,
  };
}

interface AviationstackFlight {
  flight_status?: string;
  airline?: { name?: string; iata?: string; icao?: string };
  flight?: { number?: string; iata?: string; icao?: string };
  departure?: { scheduled?: string };
  arrival?: { scheduled?: string };
  aircraft?: { icao?: string; iata?: string };
}

async function queryAviationstack(
  airlinesByCode: Record<string, string>,
  originIcao: string,
  destIcao: string,
  apiKey: string
): Promise<{ flights: CommercialFlightItem[]; providerLabel: string; note?: string }> {
  const params = new URLSearchParams({
    access_key: apiKey,
    dep_icao: originIcao,
    arr_icao: destIcao,
    limit: '30',
  });

  // Free tier on Aviationstack uses HTTP
  const url = `http://api.aviationstack.com/v1/flights?${params.toString()}`;
  const data = (await fetchJsonWithTimeout(url)) as {
    error?: { message?: string; code?: string };
    data?: AviationstackFlight[];
  };

  if (data?.error) {
    throw new Error(data.error.message || data.error.code || 'Erro na API Aviationstack');
  }

  const rawItems = Array.isArray(data?.data) ? data.data : [];
  const seen = new Set<string>();
  const flights: CommercialFlightItem[] = [];

  for (const item of rawItems) {
    const flightNum = item.flight?.iata || item.flight?.icao || item.flight?.number;
    const dep = formatTimeShort(item.departure?.scheduled);
    const key = `${flightNum || item.airline?.name}-${dep || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    flights.push({
      airlineName: resolveAirlineName(
        airlinesByCode,
        item.airline?.iata,
        item.airline?.icao,
        item.airline?.name
      ),
      airlineIata: item.airline?.iata || undefined,
      airlineIcao: item.airline?.icao || undefined,
      flightNumber: item.flight?.iata || flightNum || undefined,
      flightIcao: item.flight?.icao || undefined,
      depTime: dep,
      arrTime: formatTimeShort(item.arrival?.scheduled),
      status: item.flight_status || undefined,
      equipment: item.aircraft?.icao || item.aircraft?.iata || undefined,
    });
  }

  return {
    flights,
    providerLabel: 'Aviationstack (ao vivo)',
    note:
      flights.length === 0
        ? 'Nenhum voo comercial ativo/programado encontrado no momento via Aviationstack.'
        : undefined,
  };
}

export function lookupOfflineCommercialRoutes(
  dataset: CommercialRoutesDataset,
  originIcao: string,
  destIcao: string
): CommercialFlightItem[] {
  const key = `${originIcao.toUpperCase()}-${destIcao.toUpperCase()}`;
  return dataset.routesByPair[key] ?? [];
}

export async function getCommercialRoutesForPair(
  dataset: CommercialRoutesDataset,
  params: {
    originIcao: string;
    destinationIcao: string;
    originIata?: string;
    destinationIata?: string;
    useLiveApi?: boolean;
  },
  settings: ApiSettings
): Promise<CommercialRouteLookup> {
  const orig = params.originIcao.trim().toUpperCase();
  const dest = params.destinationIcao.trim().toUpperCase();
  const offlineFlights = lookupOfflineCommercialRoutes(dataset, orig, dest);

  const apiKey = settings.apiKey.trim();
  if (!params.useLiveApi || !apiKey) {
    return {
      originIcao: orig,
      destinationIcao: dest,
      source: offlineFlights.length > 0 ? 'offline_openflights' : 'none',
      providerLabel: 'Base offline OpenFlights',
      flights: offlineFlights,
      offlineAirlinesCount: offlineFlights.length,
      note:
        offlineFlights.length > 0
          ? 'Companhias registradas na base histórica OpenFlights (sem números de voo).'
          : 'Nenhuma companhia comercial regular encontrada na base offline para este par.',
    };
  }

  const cacheKey = `${settings.provider}:${orig}-${dest}`;
  const cached = liveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      originIcao: orig,
      destinationIcao: dest,
      source: cached.flights.length > 0 ? 'live_api' : offlineFlights.length > 0 ? 'offline_openflights' : 'none',
      providerLabel: cached.providerLabel,
      flights: cached.flights.length > 0 ? cached.flights : offlineFlights,
      offlineAirlinesCount: offlineFlights.length,
      note: cached.note,
    };
  }

  try {
    const liveResult =
      settings.provider === 'aviationstack'
        ? await queryAviationstack(dataset.airlinesByCode, orig, dest, apiKey)
        : await queryAirLabs(
            dataset.airlinesByCode,
            orig,
            dest,
            params.originIata,
            params.destinationIata,
            apiKey
          );

    liveCache.set(cacheKey, {
      expiresAt: Date.now() + LIVE_CACHE_TTL_MS,
      flights: liveResult.flights,
      providerLabel: liveResult.providerLabel,
      note: liveResult.note,
    });

    if (liveResult.flights.length > 0) {
      return {
        originIcao: orig,
        destinationIcao: dest,
        source: 'live_api',
        providerLabel: liveResult.providerLabel,
        flights: liveResult.flights,
        offlineAirlinesCount: offlineFlights.length,
        note: liveResult.note,
      };
    }

    return {
      originIcao: orig,
      destinationIcao: dest,
      source: offlineFlights.length > 0 ? 'offline_openflights' : 'none',
      providerLabel: liveResult.providerLabel,
      flights: offlineFlights,
      offlineAirlinesCount: offlineFlights.length,
      note:
        offlineFlights.length > 0
          ? `${liveResult.note} Exibindo companhias da base offline OpenFlights.`
          : liveResult.note,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar API de voos';
    return {
      originIcao: orig,
      destinationIcao: dest,
      source: offlineFlights.length > 0 ? 'offline_openflights' : 'none',
      providerLabel: 'Base offline OpenFlights',
      flights: offlineFlights,
      offlineAirlinesCount: offlineFlights.length,
      error: `Falha na API ao vivo: ${message}`,
    };
  }
}

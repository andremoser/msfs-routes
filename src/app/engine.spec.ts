import { getCommercialRoutesForPair, lookupOfflineCommercialRoutes } from '../../electron/commercial-routes';
import { buildMsfsPlnXml, formatMsfsCoordinate } from '../../electron/pln-exporter';
import { findMatchingRoutes, haversineNm, searchAirportsList } from '../../electron/route-engine';
import { AircraftProfile, AirportRecord } from '../../shared/types';

const SAMPLE_AIRCRAFT: AircraftProfile[] = [
  {
    icao: 'B738',
    name: 'Boeing 737-800',
    category: 'Narrowbody',
    cruiseKtas: 453,
    maxRangeNm: 2935,
    minRunwayFt: 6600,
    requiresPaved: true,
    typicalCruiseAltFt: 36000,
  },
  {
    icao: 'C172',
    name: 'Cessna 172 Skyhawk',
    category: 'Piston',
    cruiseKtas: 122,
    maxRangeNm: 640,
    minRunwayFt: 1700,
    requiresPaved: false,
    typicalCruiseAltFt: 7500,
  },
];

const SAMPLE_AIRPORTS: AirportRecord[] = [
  {
    icao: 'SBGR',
    iata: 'GRU',
    name: 'Guarulhos Intl',
    city: 'São Paulo',
    country: 'BR',
    continent: 'SA',
    type: 'large_airport',
    lat: -23.4356,
    lon: -46.4731,
    elevationFt: 2461,
    maxRunwayFt: 12139,
    hasPavedRunway: true,
  },
  {
    icao: 'SBRJ',
    iata: 'SDU',
    name: 'Santos Dumont',
    city: 'Rio de Janeiro',
    country: 'BR',
    continent: 'SA',
    type: 'medium_airport',
    lat: -22.9105,
    lon: -43.1631,
    elevationFt: 11,
    maxRunwayFt: 4341,
    hasPavedRunway: true,
  },
  {
    icao: 'SBGL',
    iata: 'GIG',
    name: 'Galeão Intl',
    city: 'Rio de Janeiro',
    country: 'BR',
    continent: 'SA',
    type: 'large_airport',
    lat: -22.81,
    lon: -43.2506,
    elevationFt: 28,
    maxRunwayFt: 13123,
    hasPavedRunway: true,
  },
  {
    icao: 'SDCO',
    name: 'Sorocaba Airport',
    city: 'Sorocaba',
    country: 'BR',
    continent: 'SA',
    type: 'small_airport',
    lat: -23.4831,
    lon: -47.4864,
    elevationFt: 2077,
    maxRunwayFt: 4856,
    hasPavedRunway: true,
  },
  {
    icao: 'SBFZ',
    iata: 'FOR',
    name: 'Pinto Martins Intl',
    city: 'Fortaleza',
    country: 'BR',
    continent: 'SA',
    type: 'large_airport',
    lat: -3.7763,
    lon: -38.5326,
    elevationFt: 82,
    maxRunwayFt: 8350,
    hasPavedRunway: true,
  },
  {
    icao: 'KJFK',
    iata: 'JFK',
    name: 'John F Kennedy Intl',
    city: 'New York',
    country: 'US',
    continent: 'NA',
    type: 'large_airport',
    lat: 40.6398,
    lon: -73.7789,
    elevationFt: 13,
    maxRunwayFt: 14511,
    hasPavedRunway: true,
  },
];

describe('Route Engine', () => {
  it('computes accurate great-circle distance between SBGR and SBGL', () => {
    const dist = haversineNm(-23.4356, -46.4731, -22.81, -43.2506);
    expect(dist).toBeGreaterThan(175);
    expect(dist).toBeLessThan(195);
  });

  it('filters routes from origin airport respecting runway length and max distance', () => {
    const result = findMatchingRoutes(SAMPLE_AIRPORTS, SAMPLE_AIRCRAFT, {
      aircraftIcao: 'B738',
      minRunwayFt: 6600,
      requiresPaved: true,
      regionId: 'country:BR',
      originIcao: 'SBGR',
      minDistanceNm: 50,
      maxDistanceNm: 400,
      airportSizes: ['large_airport', 'medium_airport'],
      limit: 20,
      sortBy: 'distance_asc',
      respectAircraftRange: true,
    });

    // SBRJ (4341 ft) and SBFZ (>1200 NM) and KJFK (US) should be excluded; SBGL matches
    expect(result.routes.map((r) => r.destination.icao)).toEqual(['SBGL']);
    expect(result.warning).toBeUndefined();
  });

  it('clamps distance when exceeding aircraft max range if respectAircraftRange is true', () => {
    const result = findMatchingRoutes(SAMPLE_AIRPORTS, SAMPLE_AIRCRAFT, {
      aircraftIcao: 'C172',
      minRunwayFt: 1700,
      requiresPaved: false,
      regionId: 'country:BR',
      originIcao: 'SBGR',
      minDistanceNm: 20,
      maxDistanceNm: 2000,
      airportSizes: ['large_airport', 'medium_airport', 'small_airport'],
      limit: 20,
      sortBy: 'distance_asc',
      respectAircraftRange: true,
    });

    expect(result.effectiveMaxDistanceNm).toBe(640);
    expect(result.warning).toContain('640 NM');
    expect(result.routes.map((r) => r.destination.icao)).toEqual(['SDCO', 'SBGL', 'SBRJ']);
  });

  it('searches airports by ICAO or city', () => {
    const matches = searchAirportsList(SAMPLE_AIRPORTS, 'Guarulhos');
    expect(matches[0]?.icao).toBe('SBGR');
  });
});

describe('MSFS PLN Exporter', () => {
  it('formats MSFS coordinates and generates valid AceXML flight plan', () => {
    const formatted = formatMsfsCoordinate(-23.4356, -46.4731, 2461);
    expect(formatted).toContain('S23°');
    expect(formatted).toContain('W46°');
    expect(formatted).toContain('+002461.00');

    const xml = buildMsfsPlnXml({
      id: 'SBGR-SBGL',
      origin: SAMPLE_AIRPORTS[0],
      destination: SAMPLE_AIRPORTS[2],
      distanceNm: 184,
      bearingDeg: 78,
      estimatedMinutes: 36,
      aircraft: SAMPLE_AIRCRAFT[0],
    });

    expect(xml).toContain('<SimBase.Document Type="AceXML" version="1,0">');
    expect(xml).toContain('<DepartureID>SBGR</DepartureID>');
    expect(xml).toContain('<DestinationID>SBGL</DestinationID>');
    expect(xml).toContain('<CruisingAlt>36000.000</CruisingAlt>');
  });
});

describe('Commercial Routes Lookup', () => {
  const dataset = {
    airlinesByCode: { G3: 'GOL Linhas Aéreas', AD: 'Azul Linhas Aéreas' },
    routesByPair: {
      'SBGR-SBRJ': [
        { airlineName: 'GOL Linhas Aéreas', airlineIata: 'G3', airlineIcao: 'GLO', equipment: '738' },
      ],
    },
  };

  it('returns offline OpenFlights operators when no API key is used', async () => {
    const direct = lookupOfflineCommercialRoutes(dataset, 'sbgr', 'sbrj');
    expect(direct.length).toBe(1);
    expect(direct[0].airlineName).toBe('GOL Linhas Aéreas');

    const res = await getCommercialRoutesForPair(
      dataset,
      { originIcao: 'SBGR', destinationIcao: 'SBRJ', useLiveApi: false },
      { provider: 'airlabs', apiKey: '' }
    );
    expect(res.source).toBe('offline_openflights');
    expect(res.flights[0].airlineIcao).toBe('GLO');
  });
});

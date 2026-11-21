export type AircraftCategory =
  | 'Piston'
  | 'Turboprop'
  | 'Business Jet'
  | 'Regional'
  | 'Narrowbody'
  | 'Widebody'
  | 'Utility / Bush';

export interface AircraftProfile {
  icao: string;
  name: string;
  category: AircraftCategory;
  cruiseKtas: number;
  maxRangeNm: number;
  minRunwayFt: number;
  requiresPaved: boolean;
  typicalCruiseAltFt: number;
  isPreset?: boolean;
  aliases?: string[];
}

export type AirportSize = 'large_airport' | 'medium_airport' | 'small_airport';

export interface AirportRecord {
  icao: string;
  iata?: string;
  name: string;
  city: string;
  country: string;
  continent: string;
  type: AirportSize;
  lat: number;
  lon: number;
  elevationFt: number;
  maxRunwayFt: number;
  hasPavedRunway: boolean;
}

export interface RegionOption {
  id: string;
  label: string;
  group: 'Continente' | 'País / Área';
}

export type RouteSortMode = 'random' | 'distance_asc' | 'distance_desc' | 'hub_priority';

export interface RouteSearchParams {
  aircraftIcao: string;
  minRunwayFt: number;
  requiresPaved: boolean;
  regionId: string;
  originIcao?: string;
  minDistanceNm: number;
  maxDistanceNm: number;
  airportSizes: AirportSize[];
  limit: number;
  sortBy: RouteSortMode;
  respectAircraftRange: boolean;
}

export interface SuggestedRoute {
  id: string;
  origin: AirportRecord;
  destination: AirportRecord;
  distanceNm: number;
  bearingDeg: number;
  estimatedMinutes: number;
  aircraft: AircraftProfile;
}

export interface RouteSearchResult {
  routes: SuggestedRoute[];
  candidateAirportsCount: number;
  totalMatchingPairs: number;
  effectiveMaxDistanceNm: number;
  warning?: string;
}

export interface MetarCloud {
  cover: string;
  baseFt?: number;
}

export interface MetarInfo {
  stationIcao: string;
  requestedIcao: string;
  isNearbyFallback: boolean;
  distanceFromAirportNm?: number;
  raw: string;
  flightCategory?: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | string;
  obsTime?: string;
  tempC?: number | null;
  dewpointC?: number | null;
  windDirDeg?: number | 'VRB' | null;
  windSpeedKt?: number | null;
  windGustKt?: number | null;
  visibility?: string | null;
  altimeterHpa?: number | null;
  altimeterInHg?: number | null;
  clouds: MetarCloud[];
  unavailableReason?: string;
}

export type CommercialProvider = 'airlabs' | 'aviationstack';

export interface ApiSettings {
  provider: CommercialProvider;
  apiKey: string;
}

export interface CommercialFlightItem {
  airlineName: string;
  airlineIata?: string;
  airlineIcao?: string;
  flightNumber?: string;
  flightIcao?: string;
  depTime?: string;
  arrTime?: string;
  status?: string;
  equipment?: string;
  isCodeshare?: boolean;
}

export interface CommercialRouteLookup {
  originIcao: string;
  destinationIcao: string;
  source: 'live_api' | 'offline_openflights' | 'none';
  providerLabel: string;
  flights: CommercialFlightItem[];
  offlineAirlinesCount: number;
  note?: string;
  error?: string;
}

export interface AeroDesktopApi {
  getMetadata: () => Promise<{
    aircraft: AircraftProfile[];
    regions: RegionOption[];
    totalAirports: number;
  }>;
  searchAirports: (query: string, regionId?: string) => Promise<AirportRecord[]>;
  findRoutes: (params: RouteSearchParams) => Promise<RouteSearchResult>;
  getMetar: (icaos: string[]) => Promise<Record<string, MetarInfo>>;
  getCommercialRoutes: (params: {
    originIcao: string;
    destinationIcao: string;
    originIata?: string;
    destinationIata?: string;
    useLiveApi?: boolean;
  }) => Promise<CommercialRouteLookup>;
  getApiSettings: () => Promise<ApiSettings>;
  saveApiSettings: (settings: ApiSettings) => Promise<ApiSettings>;
  exportPln: (route: SuggestedRoute) => Promise<{ saved: boolean; filePath?: string; canceled?: boolean }>;
  openSimBrief: (route: SuggestedRoute) => Promise<void>;
}

declare global {
  interface Window {
    aeroApi?: AeroDesktopApi;
  }
}

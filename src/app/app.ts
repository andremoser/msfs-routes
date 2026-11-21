import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AircraftProfile,
  AirportRecord,
  AirportSize,
  ApiSettings,
  CommercialProvider,
  CommercialRouteLookup,
  MetarInfo,
  RegionOption,
  RouteSearchResult,
  RouteSortMode,
  SuggestedRoute,
} from '../../shared/types';
import { CommercialFlightsCardComponent } from './components/commercial-flights-card/commercial-flights-card.component';
import { MetarCardComponent } from './components/metar-card/metar-card.component';
import { RouteMapComponent } from './components/route-map/route-map.component';
import { AeroService } from './services/aero.service';

const THEME_STORAGE_KEY = 'aeroroute-theme';
const MAX_AIRCRAFT_DROPDOWN_ITEMS = 150;

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouteMapComponent,
    MetarCardComponent,
    CommercialFlightsCardComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly aero = inject(AeroService);

  readonly String = String;
  readonly Math = Math;

  // Theme
  readonly theme = signal<'dark' | 'light'>('dark');

  // Catalog metadata
  readonly aircraftList = signal<AircraftProfile[]>([]);
  readonly regions = signal<RegionOption[]>([]);
  readonly totalAirports = signal<number>(0);

  // Environment / status
  readonly isElectron = this.aero.isElectron;
  readonly initError = signal<string | null>(null);
  readonly searchingRoutes = signal<boolean>(false);
  readonly loadingMetar = signal<boolean>(false);
  readonly toastMessage = signal<string | null>(null);

  // Search form signals
  readonly aircraftQuery = signal<string>('B738');
  readonly selectedAircraftIcao = signal<string>('B738');
  readonly aircraftDropdownOpen = signal<boolean>(false);
  readonly aircraftFilterActive = signal<boolean>(false);
  readonly aircraftCategoryFilter = signal<string>('ALL');

  readonly aircraftCategories = [
    'ALL',
    'Piston',
    'Utility / Bush',
    'Turboprop',
    'Business Jet',
    'Regional',
    'Narrowbody',
    'Widebody',
  ] as const;

  readonly minRunwayFt = signal<number>(6600);
  readonly requiresPaved = signal<boolean>(true);
  readonly regionId = signal<string>('country:BR');

  readonly originQuery = signal<string>('');
  readonly selectedOrigin = signal<AirportRecord | null>(null);
  readonly originSuggestions = signal<AirportRecord[]>([]);
  readonly originDropdownOpen = signal<boolean>(false);

  readonly minDistanceNm = signal<number>(80);
  readonly maxDistanceNm = signal<number>(800);
  readonly respectAircraftRange = signal<boolean>(true);
  readonly airportSizes = signal<AirportSize[]>(['large_airport', 'medium_airport']);
  readonly sortBy = signal<RouteSortMode>('random');
  readonly resultLimit = signal<number>(30);

  // Results
  readonly searchResult = signal<RouteSearchResult | null>(null);
  readonly selectedRoute = signal<SuggestedRoute | null>(null);
  readonly metarMap = signal<Record<string, MetarInfo>>({});
  readonly commercialLookup = signal<CommercialRouteLookup | null>(null);
  readonly loadingCommercial = signal<boolean>(false);

  // API Settings Modal
  readonly apiSettings = signal<ApiSettings>({ provider: 'airlabs', apiKey: '' });
  readonly settingsOpen = signal<boolean>(false);
  readonly apiProviderDraft = signal<CommercialProvider>('airlabs');
  readonly apiKeyDraft = signal<string>('');
  readonly showApiKey = signal<boolean>(false);
  readonly hasApiKey = computed(() => Boolean(this.apiSettings().apiKey.trim()));

  private originSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly continentRegions = computed(() =>
    this.regions().filter((r) => r.group === 'Continente')
  );
  readonly areaRegions = computed(() =>
    this.regions().filter((r) => r.group === 'País / Área')
  );

  readonly filteredAircraft = computed(() => {
    const cat = this.aircraftCategoryFilter();
    const list =
      cat === 'ALL'
        ? this.aircraftList()
        : this.aircraftList().filter((a) => a.category === cat);

    if (!this.aircraftFilterActive()) {
      return list;
    }

    const q = normalizeSearchText(this.aircraftQuery().trim());
    if (!q) return list;

    const tokens = q.split(/\s+/).filter(Boolean);
    return list.filter((a) => {
      const haystack = normalizeSearchText(
        [a.icao, a.name, a.category, ...(a.aliases ?? [])].join(' ')
      );
      return tokens.every((tok) => haystack.includes(tok));
    });
  });

  readonly visibleAircraft = computed(() =>
    this.filteredAircraft().slice(0, MAX_AIRCRAFT_DROPDOWN_ITEMS)
  );

  readonly activeAircraftProfile = computed<AircraftProfile>(() => {
    const code = this.selectedAircraftIcao().trim().toUpperCase();
    const found = this.aircraftList().find((a) => a.icao === code);
    if (found) return found;
    return {
      icao: code || 'CSTM',
      name: `${code || 'Custom'} (Personalizada)`,
      category: 'Turboprop',
      cruiseKtas: 260,
      maxRangeNm: 1800,
      minRunwayFt: this.minRunwayFt(),
      requiresPaved: this.requiresPaved(),
      typicalCruiseAltFt: 24000,
    };
  });

  constructor() {
    this.restoreTheme();
  }

  async ngOnInit(): Promise<void> {
    if (!this.isElectron) {
      this.initError.set(
        'Você abriu apenas o servidor Angular no navegador. Inicie com "npm run dev" para abrir o app Electron com a base de aeroportos e METAR.'
      );
      return;
    }

    try {
      const [meta, settings] = await Promise.all([
        this.aero.getMetadata(),
        this.aero.getApiSettings(),
      ]);
      this.aircraftList.set(meta.aircraft);
      this.regions.set(meta.regions);
      this.totalAirports.set(meta.totalAirports);
      this.apiSettings.set(settings);

      const defaultAc = meta.aircraft.find((a) => a.icao === 'B738') ?? meta.aircraft[0];
      if (defaultAc) {
        this.applyAircraftPreset(defaultAc, false);
      }

      await this.runSearch();
    } catch (err) {
      this.initError.set(err instanceof Error ? err.message : 'Erro ao inicializar aplicação.');
    }
  }

  toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
  }

  private restoreTheme(): void {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') {
        this.applyTheme(saved);
        return;
      }
    } catch {
      // ignore storage errors
    }
    this.applyTheme('dark');
  }

  private applyTheme(mode: 'dark' | 'light'): void {
    this.theme.set(mode);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', mode === 'dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  }

  openAircraftDropdown(): void {
    this.aircraftFilterActive.set(false);
    this.aircraftDropdownOpen.set(true);
  }

  toggleAircraftDropdown(): void {
    if (this.aircraftDropdownOpen()) {
      this.aircraftDropdownOpen.set(false);
    } else {
      this.openAircraftDropdown();
    }
  }

  onAircraftInputChange(value: string): void {
    const upper = value.toUpperCase();
    this.aircraftQuery.set(upper);
    this.aircraftFilterActive.set(true);
    this.aircraftDropdownOpen.set(true);

    const exact = this.aircraftList().find((a) => a.icao === upper.trim());
    if (exact) {
      this.applyAircraftPreset(exact, false);
    } else if (upper.trim().length >= 2) {
      this.selectedAircraftIcao.set(upper.trim());
    }
  }

  selectAircraft(ac: AircraftProfile): void {
    this.aircraftFilterActive.set(false);
    this.applyAircraftPreset(ac, true);
    this.aircraftDropdownOpen.set(false);
  }

  private applyAircraftPreset(ac: AircraftProfile, closeDropdown: boolean): void {
    this.selectedAircraftIcao.set(ac.icao);
    this.aircraftQuery.set(ac.icao);
    this.minRunwayFt.set(ac.minRunwayFt);
    this.requiresPaved.set(ac.requiresPaved);

    if (ac.category === 'Narrowbody' || ac.category === 'Widebody' || ac.category === 'Regional') {
      this.airportSizes.set(['large_airport', 'medium_airport']);
    } else if (ac.category === 'Business Jet') {
      this.airportSizes.set(['large_airport', 'medium_airport', 'small_airport']);
    } else {
      this.airportSizes.set(['medium_airport', 'small_airport', 'large_airport']);
    }

    if (closeDropdown) {
      this.aircraftDropdownOpen.set(false);
    }
  }

  closeAircraftDropdownLater(): void {
    setTimeout(() => this.aircraftDropdownOpen.set(false), 160);
  }

  onOriginInputChange(value: string): void {
    this.originQuery.set(value);
    if (!value.trim()) {
      this.selectedOrigin.set(null);
      this.originSuggestions.set([]);
      this.originDropdownOpen.set(false);
      return;
    }

    if (this.originSearchTimer) clearTimeout(this.originSearchTimer);
    this.originSearchTimer = setTimeout(async () => {
      try {
        const results = await this.aero.searchAirports(value);
        this.originSuggestions.set(results);
        this.originDropdownOpen.set(true);
      } catch {
        this.originSuggestions.set([]);
      }
    }, 150);
  }

  selectOriginAirport(ap: AirportRecord): void {
    this.selectedOrigin.set(ap);
    this.originQuery.set(`${ap.icao} — ${ap.city} (${ap.country})`);
    this.originDropdownOpen.set(false);
  }

  clearOriginAirport(): void {
    this.selectedOrigin.set(null);
    this.originQuery.set('');
    this.originSuggestions.set([]);
    this.originDropdownOpen.set(false);
  }

  closeOriginDropdownLater(): void {
    setTimeout(() => this.originDropdownOpen.set(false), 160);
  }

  toggleAirportSize(size: AirportSize): void {
    const current = this.airportSizes();
    if (current.includes(size)) {
      if (current.length === 1) return;
      this.airportSizes.set(current.filter((s) => s !== size));
    } else {
      this.airportSizes.set([...current, size]);
    }
  }

  hasSize(size: AirportSize): boolean {
    return this.airportSizes().includes(size);
  }

  async runSearch(): Promise<void> {
    if (!this.isElectron) return;
    this.searchingRoutes.set(true);
    try {
      const result = await this.aero.findRoutes({
        aircraftIcao: this.selectedAircraftIcao(),
        minRunwayFt: Number(this.minRunwayFt()) || 0,
        requiresPaved: this.requiresPaved(),
        regionId: this.regionId(),
        originIcao: this.selectedOrigin()?.icao,
        minDistanceNm: Number(this.minDistanceNm()) || 0,
        maxDistanceNm: Number(this.maxDistanceNm()) || 500,
        airportSizes: this.airportSizes(),
        limit: this.resultLimit(),
        sortBy: this.sortBy(),
        respectAircraftRange: this.respectAircraftRange(),
      });

      this.searchResult.set(result);
      const first = result.routes[0] ?? null;
      this.selectedRoute.set(first);

      if (first) {
        await Promise.all([
          this.loadMetarForRoute(first),
          this.loadCommercialForRoute(first, false),
        ]);
      } else {
        this.commercialLookup.set(null);
      }
    } finally {
      this.searchingRoutes.set(false);
    }
  }

  async selectRoute(route: SuggestedRoute): Promise<void> {
    this.selectedRoute.set(route);
    await Promise.all([
      this.loadMetarForRoute(route),
      this.loadCommercialForRoute(route, false),
    ]);
  }

  async refreshSelectedMetar(): Promise<void> {
    const route = this.selectedRoute();
    if (!route) return;
    await this.loadMetarForRoute(route);
  }

  async fetchLiveCommercialFlights(): Promise<void> {
    const route = this.selectedRoute();
    if (!route) return;
    await this.loadCommercialForRoute(route, true);
  }

  openApiSettings(): void {
    const current = this.apiSettings();
    this.apiProviderDraft.set(current.provider);
    this.apiKeyDraft.set(current.apiKey);
    this.showApiKey.set(false);
    this.settingsOpen.set(true);
  }

  async saveApiSettings(): Promise<void> {
    const saved = await this.aero.saveApiSettings({
      provider: this.apiProviderDraft(),
      apiKey: this.apiKeyDraft(),
    });
    this.apiSettings.set(saved);
    this.settingsOpen.set(false);
    this.showToast(
      saved.apiKey
        ? 'API Key salva! Clique em "Buscar Nº dos Voos (Ao Vivo)" na rota selecionada.'
        : 'API Key removida. Usando apenas base offline OpenFlights.'
    );
  }

  private async loadCommercialForRoute(route: SuggestedRoute, useLiveApi: boolean): Promise<void> {
    this.loadingCommercial.set(true);
    try {
      const res = await this.aero.getCommercialRoutes({
        originIcao: route.origin.icao,
        destinationIcao: route.destination.icao,
        originIata: route.origin.iata,
        destinationIata: route.destination.iata,
        useLiveApi,
      });
      this.commercialLookup.set(res);
    } finally {
      this.loadingCommercial.set(false);
    }
  }

  private async loadMetarForRoute(route: SuggestedRoute): Promise<void> {
    this.loadingMetar.set(true);
    try {
      const res = await this.aero.getMetar([route.origin.icao, route.destination.icao]);
      this.metarMap.update((prev) => ({ ...prev, ...res }));
    } finally {
      this.loadingMetar.set(false);
    }
  }

  async exportSelectedPln(): Promise<void> {
    const route = this.selectedRoute();
    if (!route) return;
    const res = await this.aero.exportPln(route);
    if (res.saved && res.filePath) {
      this.showToast(`Plano .PLN salvo em: ${res.filePath}`);
    }
  }

  async openSelectedInSimBrief(): Promise<void> {
    const route = this.selectedRoute();
    if (!route) return;
    await this.aero.openSimBrief(route);
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }

  sizeLabel(size: AirportSize): string {
    switch (size) {
      case 'large_airport':
        return 'Grande';
      case 'medium_airport':
        return 'Médio';
      case 'small_airport':
        return 'Pequeno';
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMessage.set(null), 5000);
  }
}

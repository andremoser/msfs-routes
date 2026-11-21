import { Injectable } from '@angular/core';
import {
  AeroDesktopApi,
  AirportRecord,
  ApiSettings,
  CommercialRouteLookup,
  MetarInfo,
  RouteSearchParams,
  RouteSearchResult,
  SuggestedRoute,
} from '../../../shared/types';

@Injectable({
  providedIn: 'root',
})
export class AeroService {
  private get api(): AeroDesktopApi {
    if (!window.aeroApi) {
      throw new Error(
        'API do Electron indisponível. Execute o aplicativo via "npm run dev" ou pelo executável desktop.'
      );
    }
    return window.aeroApi;
  }

  get isElectron(): boolean {
    return Boolean(window.aeroApi);
  }

  getMetadata() {
    return this.api.getMetadata();
  }

  searchAirports(query: string, regionId?: string): Promise<AirportRecord[]> {
    return this.api.searchAirports(query, regionId);
  }

  findRoutes(params: RouteSearchParams): Promise<RouteSearchResult> {
    return this.api.findRoutes(params);
  }

  getMetar(icaos: string[]): Promise<Record<string, MetarInfo>> {
    return this.api.getMetar(icaos);
  }

  getCommercialRoutes(params: {
    originIcao: string;
    destinationIcao: string;
    originIata?: string;
    destinationIata?: string;
    useLiveApi?: boolean;
  }): Promise<CommercialRouteLookup> {
    return this.api.getCommercialRoutes(params);
  }

  getApiSettings(): Promise<ApiSettings> {
    return this.api.getApiSettings();
  }

  saveApiSettings(settings: ApiSettings): Promise<ApiSettings> {
    return this.api.saveApiSettings(settings);
  }

  exportPln(route: SuggestedRoute) {
    return this.api.exportPln(route);
  }

  openSimBrief(route: SuggestedRoute): Promise<void> {
    return this.api.openSimBrief(route);
  }
}

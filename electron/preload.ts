import { contextBridge, ipcRenderer } from 'electron';
import { AeroDesktopApi, ApiSettings, RouteSearchParams, SuggestedRoute } from '../shared/types';

const api: AeroDesktopApi = {
  getMetadata: () => ipcRenderer.invoke('aero:get-metadata'),
  searchAirports: (query: string, regionId?: string) =>
    ipcRenderer.invoke('aero:search-airports', query, regionId),
  findRoutes: (params: RouteSearchParams) => ipcRenderer.invoke('aero:find-routes', params),
  getMetar: (icaos: string[]) => ipcRenderer.invoke('aero:get-metar', icaos),
  getCommercialRoutes: (params) => ipcRenderer.invoke('aero:get-commercial-routes', params),
  getApiSettings: () => ipcRenderer.invoke('aero:get-api-settings'),
  saveApiSettings: (settings: ApiSettings) => ipcRenderer.invoke('aero:save-api-settings', settings),
  exportPln: (route: SuggestedRoute) => ipcRenderer.invoke('aero:export-pln', route),
  openSimBrief: (route: SuggestedRoute) => ipcRenderer.invoke('aero:open-simbrief', route),
};

contextBridge.exposeInMainWorld('aeroApi', api);

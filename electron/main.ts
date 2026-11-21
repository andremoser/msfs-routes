import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  AircraftProfile,
  AirportRecord,
  ApiSettings,
  RouteSearchParams,
  SuggestedRoute,
} from '../shared/types';
import {
  CommercialRoutesDataset,
  getCommercialRoutesForPair,
} from './commercial-routes';
import { getMetarsForIcaos } from './metar';
import { buildMsfsPlnXml } from './pln-exporter';
import { REGION_OPTIONS } from './regions';
import { findMatchingRoutes, searchAirportsList } from './route-engine';

let mainWindow: BrowserWindow | null = null;
let cachedAirports: AirportRecord[] | null = null;
let cachedAircraft: AircraftProfile[] | null = null;
let cachedCommercialRoutes: CommercialRoutesDataset | null = null;

function resolveDataFile(filename: string): string {
  const candidates = [
    path.join(__dirname, 'data', filename),
    path.join(app.getAppPath(), 'electron', 'data', filename),
    path.join(process.resourcesPath || '', 'data', filename),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Data file not found: ${filename}`);
}

function getAirports(): AirportRecord[] {
  if (!cachedAirports) {
    const filePath = resolveDataFile('airports.json.gz');
    const gz = fs.readFileSync(filePath);
    const json = zlib.gunzipSync(gz).toString('utf-8');
    cachedAirports = JSON.parse(json) as AirportRecord[];
  }
  return cachedAirports;
}

function getAircraft(): AircraftProfile[] {
  if (!cachedAircraft) {
    const gzPath = resolveDataFile('aircraft.json.gz');
    const gz = fs.readFileSync(gzPath);
    const json = zlib.gunzipSync(gz).toString('utf-8');
    cachedAircraft = JSON.parse(json) as AircraftProfile[];
  }
  return cachedAircraft;
}

function getCommercialDataset(): CommercialRoutesDataset {
  if (!cachedCommercialRoutes) {
    const gzPath = resolveDataFile('commercial-routes.json.gz');
    const gz = fs.readFileSync(gzPath);
    const json = zlib.gunzipSync(gz).toString('utf-8');
    cachedCommercialRoutes = JSON.parse(json) as CommercialRoutesDataset;
  }
  return cachedCommercialRoutes;
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'api-settings.json');
}

function readApiSettings(): ApiSettings {
  try {
    const file = getSettingsPath();
    if (!fs.existsSync(file)) {
      return { provider: 'airlabs', apiKey: '' };
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ApiSettings>;
    return {
      provider: parsed.provider === 'aviationstack' ? 'aviationstack' : 'airlabs',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return { provider: 'airlabs', apiKey: '' };
  }
}

function writeApiSettings(settings: ApiSettings): ApiSettings {
  const clean: ApiSettings = {
    provider: settings.provider === 'aviationstack' ? 'aviationstack' : 'airlabs',
    apiKey: (settings.apiKey || '').trim(),
  };
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(clean, null, 2), 'utf-8');
  return clean;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0b1120',
    title: 'AeroRoute — Planejador de Rotas MSFS 2024',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env['ELECTRON_START_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const indexHtml = path.join(app.getAppPath(), 'dist', 'aero-route', 'browser', 'index.html');
    mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('aero:get-metadata', () => {
    return {
      aircraft: getAircraft(),
      regions: REGION_OPTIONS,
      totalAirports: getAirports().length,
    };
  });

  ipcMain.handle('aero:search-airports', (_event, query: string, regionId?: string) => {
    return searchAirportsList(getAirports(), query || '', regionId);
  });

  ipcMain.handle('aero:find-routes', (_event, params: RouteSearchParams) => {
    return findMatchingRoutes(getAirports(), getAircraft(), params);
  });

  ipcMain.handle('aero:get-metar', async (_event, icaos: string[]) => {
    return getMetarsForIcaos(Array.isArray(icaos) ? icaos : [], getAirports());
  });

  ipcMain.handle(
    'aero:get-commercial-routes',
    async (
      _event,
      params: {
        originIcao: string;
        destinationIcao: string;
        originIata?: string;
        destinationIata?: string;
        useLiveApi?: boolean;
      }
    ) => {
      return getCommercialRoutesForPair(getCommercialDataset(), params, readApiSettings());
    }
  );

  ipcMain.handle('aero:get-api-settings', () => {
    return readApiSettings();
  });

  ipcMain.handle('aero:save-api-settings', (_event, settings: ApiSettings) => {
    return writeApiSettings(settings);
  });

  ipcMain.handle('aero:export-pln', async (_event, route: SuggestedRoute) => {
    if (!mainWindow) {
      return { saved: false, canceled: true };
    }
    const defaultName = `${route.origin.icao}_${route.destination.icao}_${route.aircraft.icao}.pln`;
    const docsDir = app.getPath('documents');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar Plano de Voo MSFS (.pln)',
      defaultPath: path.join(docsDir, defaultName),
      filters: [{ name: 'MSFS Flight Plan (*.pln)', extensions: ['pln'] }],
    });

    if (result.canceled || !result.filePath) {
      return { saved: false, canceled: true };
    }

    const xml = buildMsfsPlnXml(route);
    fs.writeFileSync(result.filePath, xml, 'utf-8');
    return { saved: true, filePath: result.filePath };
  });

  ipcMain.handle('aero:open-simbrief', async (_event, route: SuggestedRoute) => {
    const params = new URLSearchParams({
      orig: route.origin.icao,
      dest: route.destination.icao,
      type: route.aircraft.icao,
      fl: String(Math.round((route.aircraft.typicalCruiseAltFt || 10000) / 100)),
    });
    const url = `https://dispatch.simbrief.com/options/custom?${params.toString()}`;
    await shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  // Pre-warm dataset in memory on startup
  getAirports();
  getAircraft();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

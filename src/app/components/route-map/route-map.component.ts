import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { AirportRecord, SuggestedRoute } from '../../../../shared/types';

function interpolateGreatCircle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  steps = 36
): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1 * toRad;
  const lam1 = lon1 * toRad;
  const phi2 = lat2 * toRad;
  const lam2 = lon2 * toRad;

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((phi2 - phi1) / 2) ** 2 +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
      )
    );

  if (d === 0 || Number.isNaN(d)) {
    return [
      [lat1, lon1],
      [lat2, lon2],
    ];
  }

  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const phi = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lam = Math.atan2(y, x);
    points.push([phi * toDeg, lam * toDeg]);
  }
  return points;
}

@Component({
  selector: 'app-route-map',
  standalone: true,
  template: `
    <div class="relative h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-200 dark:border-slate-800 dark:bg-slate-950">
      <div #mapContainer class="h-full w-full"></div>

      @if (selectedRoute(); as route) {
        <div
          class="pointer-events-none absolute left-3 top-3 z-[400] rounded-lg border border-slate-200 bg-white/92 px-3 py-1.5 shadow-sm backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90"
        >
          <div class="flex items-center gap-2 font-mono text-xs">
            <span class="font-bold text-sky-600 dark:text-sky-300">{{ route.origin.icao }}</span>
            <span class="text-slate-400 dark:text-slate-500">→</span>
            <span class="font-bold text-amber-600 dark:text-amber-300">{{ route.destination.icao }}</span>
            <span class="text-slate-300 dark:text-slate-600">|</span>
            <span class="text-slate-800 dark:text-slate-200">{{ route.distanceNm }} NM</span>
            <span class="text-slate-400 dark:text-slate-600">·</span>
            <span class="text-slate-600 dark:text-slate-300">HDG {{ String(route.bearingDeg).padStart(3, '0') }}°</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class RouteMapComponent implements AfterViewInit, OnDestroy {
  readonly String = String;

  readonly routes = input<SuggestedRoute[]>([]);
  readonly selectedRoute = input<SuggestedRoute | null>(null);
  readonly theme = input<'dark' | 'light'>('dark');
  readonly routeSelected = output<SuggestedRoute>();

  private readonly mapContainer = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  private map: L.Map | null = null;
  private darkLayer: L.LayerGroup | null = null;
  private osmLayer: L.TileLayer | null = null;
  private satelliteLayer: L.TileLayer | null = null;
  private backgroundLayer = L.layerGroup();
  private activeLayer = L.layerGroup();
  private resizeObserver: ResizeObserver | null = null;
  private lastRoutesKey = '';
  private appliedTheme: 'dark' | 'light' | null = null;

  constructor() {
    effect(() => {
      const currentRoutes = this.routes();
      const selected = this.selectedRoute();
      const currentTheme = this.theme();
      if (!this.map) return;

      if (this.appliedTheme !== currentTheme) {
        this.applyThemeBaseLayer(currentTheme);
      }
      this.renderMapLayers(currentRoutes, selected, currentTheme);
    });
  }

  ngAfterViewInit(): void {
    const el = this.mapContainer().nativeElement;
    this.map = L.map(el, {
      center: [-15.79, -47.88],
      zoom: 4,
      zoomControl: true,
      worldCopyJump: true,
    });

    const darkBase = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap',
        maxZoom: 16,
      }
    );

    const darkLabels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 16,
      }
    );

    this.darkLayer = L.layerGroup([darkBase, darkLabels]);

    this.osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });

    this.satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 18,
      }
    );

    this.applyThemeBaseLayer(this.theme());

    L.control
      .layers(
        {
          'Escuro (Cockpit)': this.darkLayer,
          'Claro (OSM)': this.osmLayer,
          'Satélite (Esri)': this.satelliteLayer,
        },
        undefined,
        { position: 'topright' }
      )
      .addTo(this.map);

    this.backgroundLayer.addTo(this.map);
    this.activeLayer.addTo(this.map);

    this.resizeObserver = new ResizeObserver(() => {
      this.map?.invalidateSize();
    });
    this.resizeObserver.observe(el);

    this.renderMapLayers(this.routes(), this.selectedRoute(), this.theme());
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.map?.remove();
    this.map = null;
  }

  private applyThemeBaseLayer(theme: 'dark' | 'light'): void {
    if (!this.map || !this.darkLayer || !this.osmLayer || !this.satelliteLayer) return;
    if (this.map.hasLayer(this.satelliteLayer)) {
      this.appliedTheme = theme;
      return;
    }

    if (theme === 'dark') {
      if (this.map.hasLayer(this.osmLayer)) this.map.removeLayer(this.osmLayer);
      if (!this.map.hasLayer(this.darkLayer)) this.darkLayer.addTo(this.map);
    } else {
      if (this.map.hasLayer(this.darkLayer)) this.map.removeLayer(this.darkLayer);
      if (!this.map.hasLayer(this.osmLayer)) this.osmLayer.addTo(this.map);
    }
    this.appliedTheme = theme;
  }

  private renderMapLayers(
    routes: SuggestedRoute[],
    selected: SuggestedRoute | null,
    theme: 'dark' | 'light'
  ): void {
    if (!this.map) return;

    this.backgroundLayer.clearLayers();
    this.activeLayer.clearLayers();

    const routesKey = routes.map((r) => r.id).join('|');
    const boundsPoints: L.LatLngExpression[] = [];
    const bgLineColor = theme === 'dark' ? '#38bdf8' : '#0284c7';
    const activeLineColor = theme === 'dark' ? '#38bdf8' : '#0369a1';

    for (const route of routes) {
      const isSelected = selected?.id === route.id;
      boundsPoints.push([route.origin.lat, route.origin.lon]);
      boundsPoints.push([route.destination.lat, route.destination.lon]);

      if (isSelected) continue;

      const line = L.polyline(
        interpolateGreatCircle(
          route.origin.lat,
          route.origin.lon,
          route.destination.lat,
          route.destination.lon,
          20
        ),
        {
          color: bgLineColor,
          weight: 1.4,
          opacity: theme === 'dark' ? 0.22 : 0.3,
          dashArray: '4 6',
        }
      );
      line.on('click', () => this.routeSelected.emit(route));
      line.addTo(this.backgroundLayer);

      const destMarker = this.createDotMarker(route.destination, theme === 'dark' ? '#64748b' : '#475569', 6);
      destMarker.bindTooltip(
        `<strong>${route.destination.icao}</strong> · ${route.destination.city} (${route.distanceNm} NM)`,
        { className: 'aero-tooltip', direction: 'top' }
      );
      destMarker.on('click', () => this.routeSelected.emit(route));
      destMarker.addTo(this.backgroundLayer);
    }

    if (selected) {
      const arc = interpolateGreatCircle(
        selected.origin.lat,
        selected.origin.lon,
        selected.destination.lat,
        selected.destination.lon,
        40
      );

      L.polyline(arc, {
        color: activeLineColor,
        weight: 6,
        opacity: 0.22,
      }).addTo(this.activeLayer);

      L.polyline(arc, {
        color: activeLineColor,
        weight: 2.5,
        opacity: 0.95,
      }).addTo(this.activeLayer);

      const originMarker = this.createEndpointMarker(selected.origin, 'origin', theme);
      originMarker.bindTooltip(
        `<strong>ORIGEM ${selected.origin.icao}</strong><br>${selected.origin.city}, ${selected.origin.country}`,
        { className: 'aero-tooltip', direction: 'top' }
      );
      originMarker.addTo(this.activeLayer);

      const destMarker = this.createEndpointMarker(selected.destination, 'dest', theme);
      destMarker.bindTooltip(
        `<strong>DESTINO ${selected.destination.icao}</strong><br>${selected.destination.city}, ${selected.destination.country}`,
        { className: 'aero-tooltip', direction: 'top' }
      );
      destMarker.addTo(this.activeLayer);

      if (routesKey !== this.lastRoutesKey && boundsPoints.length > 0) {
        this.map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36], maxZoom: 7 });
      } else {
        this.map.fitBounds(
          L.latLngBounds([
            [selected.origin.lat, selected.origin.lon],
            [selected.destination.lat, selected.destination.lon],
          ]),
          { padding: [54, 54], maxZoom: 8, animate: true }
        );
      }
    } else if (boundsPoints.length > 0 && routesKey !== this.lastRoutesKey) {
      this.map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36], maxZoom: 7 });
    }

    this.lastRoutesKey = routesKey;
  }

  private createDotMarker(airport: AirportRecord, color: string, size: number): L.Marker {
    return L.marker([airport.lat, airport.lon], {
      icon: L.divIcon({
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:1px solid #0f172a;opacity:0.85;"></div>`,
      }),
    });
  }

  private createEndpointMarker(
    airport: AirportRecord,
    kind: 'origin' | 'dest',
    theme: 'dark' | 'light'
  ): L.Marker {
    const color =
      theme === 'dark'
        ? kind === 'origin'
          ? '#38bdf8'
          : '#fbbf24'
        : kind === 'origin'
          ? '#0284c7'
          : '#d97706';
    const ring = kind === 'origin' ? 'rgba(56,189,248,0.35)' : 'rgba(251,191,36,0.35)';
    const badgeBg = theme === 'dark' ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.95)';
    const dotBorder = theme === 'dark' ? '#0f172a' : '#ffffff';

    return L.marker([airport.lat, airport.lon], {
      icon: L.divIcon({
        className: '',
        iconSize: [48, 28],
        iconAnchor: [7, 7],
        html: `
          <div style="display:flex;align-items:center;gap:5px;">
            <div style="width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid ${dotBorder};box-shadow:0 0 0 5px ${ring};flex-shrink:0;"></div>
            <span style="background:${badgeBg};color:${color};border:1px solid ${color};border-radius:4px;padding:0 4px;font-family:monospace;font-size:10px;font-weight:700;line-height:16px;white-space:nowrap;">${airport.icao}</span>
          </div>
        `,
      }),
    });
  }
}

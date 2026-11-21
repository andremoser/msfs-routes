import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { AirportRecord, MetarInfo } from '../../../../shared/types';

@Component({
  selector: 'app-metar-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span
              class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              [class]="
                role() === 'ORIGEM'
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
              "
            >
              {{ role() }}
            </span>
            <span class="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
              {{ airport().icao }}
            </span>
            @if (airport().iata) {
              <span class="font-mono text-xs text-slate-500 dark:text-slate-400">({{ airport().iata }})</span>
            }
          </div>
          <p class="mt-0.5 truncate text-xs text-slate-700 dark:text-slate-300">
            {{ airport().city }}, {{ airport().country }} · {{ airport().name }}
          </p>
          <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Elev. {{ airport().elevationFt | number }} ft · Pista máx.
            {{ airport().maxRunwayFt | number }} ft ({{ Math.round(airport().maxRunwayFt * 0.3048) | number }} m)
            · {{ airport().hasPavedRunway ? 'Pavimentada' : 'Não pavimentada' }}
          </p>
        </div>

        @if (!loading() && metar()?.flightCategory) {
          <span
            class="shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-bold tracking-wide"
            [class]="flightCatBadgeClass()"
          >
            {{ metar()!.flightCategory }}
          </span>
        }
      </div>

      <div class="mt-3 border-t border-slate-200 pt-2.5 dark:border-slate-800/80">
        @if (loading()) {
          <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span class="h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent dark:border-sky-400"></span>
            Consultando METAR em tempo real...
          </div>
        } @else if (metar(); as m) {
          @if (m.unavailableReason) {
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ m.unavailableReason }}</p>
          } @else {
            @if (m.isNearbyFallback) {
              <div class="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-500/25 dark:text-amber-200">
                Sem estação METAR própria — exibindo estação próxima:
                <span class="font-mono font-semibold">{{ m.stationIcao }}</span>
                @if (m.distanceFromAirportNm !== undefined) {
                  <span>({{ m.distanceFromAirportNm }} NM)</span>
                }
              </div>
            }

            <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div class="rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-950/70">
                <div class="text-[10px] uppercase tracking-wider text-slate-500">Vento</div>
                <div class="font-mono font-semibold text-slate-900 dark:text-slate-100">{{ windText() }}</div>
              </div>

              <div class="rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-950/70">
                <div class="text-[10px] uppercase tracking-wider text-slate-500">Visibilidade</div>
                <div class="font-mono font-semibold text-slate-900 dark:text-slate-100">{{ visibilityText() }}</div>
              </div>

              <div class="rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-950/70">
                <div class="text-[10px] uppercase tracking-wider text-slate-500">QNH</div>
                <div class="font-mono font-semibold text-slate-900 dark:text-slate-100">{{ altimeterText() }}</div>
              </div>

              <div class="rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-950/70">
                <div class="text-[10px] uppercase tracking-wider text-slate-500">Temp / Orvalho</div>
                <div class="font-mono font-semibold text-slate-900 dark:text-slate-100">{{ tempText() }}</div>
              </div>

              <div class="col-span-2 rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-950/70">
                <div class="text-[10px] uppercase tracking-wider text-slate-500">Nuvens / Teto</div>
                <div class="truncate font-mono font-semibold text-slate-900 dark:text-slate-100">{{ cloudsText() }}</div>
              </div>
            </div>

            <div class="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-emerald-700 select-all dark:border-slate-800 dark:bg-slate-950 dark:text-emerald-300/95">
              {{ m.raw }}
            </div>

            @if (m.obsTime) {
              <div class="mt-1 text-right text-[10px] text-slate-500">
                Reportado em {{ formatObsTime(m.obsTime) }}
              </div>
            }
          }
        } @else {
          <p class="text-xs text-slate-500">METAR ainda não carregado.</p>
        }
      </div>
    </div>
  `,
})
export class MetarCardComponent {
  readonly Math = Math;

  readonly role = input.required<'ORIGEM' | 'DESTINO'>();
  readonly airport = input.required<AirportRecord>();
  readonly metar = input<MetarInfo | null>(null);
  readonly loading = input<boolean>(false);

  readonly flightCatBadgeClass = computed(() => {
    const cat = this.metar()?.flightCategory?.toUpperCase();
    switch (cat) {
      case 'VFR':
        return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
      case 'MVFR':
        return 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300';
      case 'IFR':
        return 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300';
      case 'LIFR':
        return 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300';
      default:
        return 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300';
    }
  });

  readonly windText = computed(() => {
    const m = this.metar();
    if (!m) return '—';
    if (m.windSpeedKt === 0) return 'Calmo (0 kt)';
    if (m.windSpeedKt === null || m.windSpeedKt === undefined) return '—';
    const dir =
      m.windDirDeg === 'VRB'
        ? 'VRB'
        : typeof m.windDirDeg === 'number'
          ? `${String(m.windDirDeg).padStart(3, '0')}°`
          : '---';
    const gust = m.windGustKt ? `G${m.windGustKt}` : '';
    return `${dir} / ${m.windSpeedKt}${gust} kt`;
  });

  readonly visibilityText = computed(() => {
    const v = this.metar()?.visibility;
    if (!v) return '—';
    return `${v} SM`;
  });

  readonly altimeterText = computed(() => {
    const m = this.metar();
    if (!m) return '—';
    if (m.altimeterHpa && m.altimeterInHg) {
      return `${m.altimeterHpa} hPa (${m.altimeterInHg.toFixed(2)})`;
    }
    if (m.altimeterHpa) return `${m.altimeterHpa} hPa`;
    return '—';
  });

  readonly tempText = computed(() => {
    const m = this.metar();
    if (!m || m.tempC === null || m.tempC === undefined) return '—';
    const temp = Math.round(m.tempC);
    const dewp =
      m.dewpointC !== null && m.dewpointC !== undefined ? `${Math.round(m.dewpointC)}°C` : '—';
    return `${temp}°C / ${dewp}`;
  });

  readonly cloudsText = computed(() => {
    const clouds = this.metar()?.clouds;
    if (!clouds || clouds.length === 0) return 'Céu claro / NCD';
    return clouds
      .map((c) => (c.baseFt !== undefined ? `${c.cover} ${c.baseFt.toLocaleString('pt-BR')} ft` : c.cover))
      .join(' · ');
  });

  formatObsTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }
}

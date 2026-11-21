import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { CommercialRouteLookup } from '../../../../shared/types';

@Component({
  selector: 'app-commercial-flights-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
            Voos Comerciais
          </span>
          @if (lookup(); as info) {
            <span class="text-[11px] text-slate-500 dark:text-slate-400">
              {{ info.providerLabel }}
            </span>
          }
        </div>

        <div class="flex items-center gap-1.5">
          @if (hasApiKey()) {
            <button
              type="button"
              (click)="fetchLiveRequested.emit()"
              [disabled]="loading()"
              class="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500 dark:text-slate-950 dark:hover:bg-indigo-400"
            >
              @if (loading()) {
                Consultando...
              } @else {
                Buscar Nº dos Voos (Ao Vivo)
              }
            </button>
          } @else {
            <button
              type="button"
              (click)="openSettingsRequested.emit()"
              class="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-500/20 dark:text-indigo-300"
            >
              Adicionar API Key (ver nº do voo)
            </button>
          }

          <button
            type="button"
            (click)="openSettingsRequested.emit()"
            title="Configurar API Key"
            class="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ⚙ API
          </button>
        </div>
      </div>

      <div class="mt-2.5 border-t border-slate-200 pt-2.5 dark:border-slate-800/80">
        @if (loading()) {
          <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span class="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></span>
            Consultando voos comerciais na rota...
          </div>
        } @else if (lookup(); as info) {
          @if (info.error) {
            <div class="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
              {{ info.error }}
            </div>
          }

          @if (info.flights.length === 0) {
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{ info.note || 'Nenhuma operação comercial regular encontrada para este par de aeroportos.' }}
            </p>
          } @else {
            @if (info.note) {
              <p class="mb-2 text-[11px] text-slate-500 dark:text-slate-400">{{ info.note }}</p>
            }

            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              @for (f of info.flights; track $index) {
                <div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      @if (f.flightNumber) {
                        <span class="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                          {{ f.flightNumber }}
                        </span>
                      } @else if (f.airlineIcao || f.airlineIata) {
                        <span class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {{ f.airlineIcao || f.airlineIata }}
                        </span>
                      }
                      <span class="truncate font-medium text-slate-800 dark:text-slate-100">
                        {{ f.airlineName }}
                      </span>
                      @if (f.isCodeshare) {
                        <span class="rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase text-amber-700 dark:text-amber-300">
                          Codeshare
                        </span>
                      }
                    </div>

                    @if (f.flightIcao && f.flightIcao !== f.flightNumber) {
                      <div class="mt-0.5 font-mono text-[10px] text-slate-500">
                        Callsign: {{ f.flightIcao }}
                      </div>
                    }
                  </div>

                  <div class="shrink-0 text-right font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    @if (f.depTime || f.arrTime) {
                      <div class="font-semibold text-slate-700 dark:text-slate-200">
                        {{ f.depTime || '??:??' }} → {{ f.arrTime || '??:??' }}
                      </div>
                    }
                    @if (f.equipment) {
                      <div>Eqp: {{ f.equipment }}</div>
                    }
                    @if (f.status) {
                      <div class="uppercase">{{ f.status }}</div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class CommercialFlightsCardComponent {
  readonly lookup = input<CommercialRouteLookup | null>(null);
  readonly loading = input<boolean>(false);
  readonly hasApiKey = input<boolean>(false);

  readonly fetchLiveRequested = output<void>();
  readonly openSettingsRequested = output<void>();
}

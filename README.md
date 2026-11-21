# AeroRoute — Planejador de Rotas MSFS 2024

Aplicativo desktop em **Electron + Angular + Tailwind CSS + Leaflet** para sugerir rotas para o **Microsoft Flight Simulator 2024** a partir do modelo ICAO da aeronave, região do mundo (ou aeroporto de origem específico), distância mínima/máxima e requisitos de pista, com **METAR ao vivo** e exportação para **`.pln`** e **SimBrief**.

## Como rodar em desenvolvimento

```bash
npm run dev
```

> **Dica para Windows PowerShell:** caso a política de execução de scripts bloqueie `npm`, use `npm.cmd run dev` ou execute pelo Prompt de Comando (`cmd`).

## Comandos úteis

- `npm run dev` — Compila o backend do Electron, sobe o servidor Angular e abre a janela do app desktop.
- `npm run sync:data` — Atualiza a base local de aeroportos e pistas a partir do OurAirports (`electron/data/airports.json.gz`).
- `npm test` — Executa os testes unitários com Vitest.
- `npm run build && npm run build:electron` — Compila Angular e Electron para produção.
- `npm run package` — Gera o instalador Windows via `electron-builder` na pasta `release/`.

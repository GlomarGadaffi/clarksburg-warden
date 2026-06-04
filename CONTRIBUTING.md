# Contributing to BearSentinel

Thanks for your interest in contributing. This guide covers everything you need to go from zero to a working development environment, understand the codebase, and submit a useful change.

## Prerequisites

- **Node.js 18+** — check with `node --version`
- **npm** (comes with Node.js)
- **Google Chrome or Microsoft Edge** — the Web Serial API is Chromium-only; you need one of these to test changes that touch serial communication
- A Uniden BCD325P2 (optional but required to test scanner integration end-to-end)

## Setup

```bash
git clone https://github.com/GlomarGadaffi/BearSentinel.git
cd BearSentinel
npm install
npm run dev
```

Open the URL printed by Vite in Chrome or Edge. `localhost` is a secure context, so Web Serial works immediately without any certificate setup.

## Building the single-file artifact

```bash
npm run build
```

`vite-plugin-singlefile` inlines all JavaScript, CSS, and assets into `dist/index.html`. This is the file you distribute or drop into a browser tab — no web server needed.

## Project structure

```
src/
├── core/
│   ├── Decoder.ts        # Pure line parser — EDACS and P25. No side effects.
│   ├── AgencyDB.ts       # Talkgroup → agency lookup table (DB, AG_COLORS, helpers)
│   ├── SentinelStore.ts  # Central state engine: event handling, analytics, localStorage
│   ├── SerialMonitor.ts  # Web Serial API read loop and GLG poll timer
│   └── useSentinel.ts    # React hook for subscribing to SentinelStore state
├── components/
│   ├── GrantFeed.tsx     # Live call grant feed
│   ├── PatchMatrix.tsx   # Multi-agency patch activity grid
│   ├── Leaderboard.tsx   # Talkgroup activity rankings (5-min / 60-min)
│   ├── LCNMap.tsx        # Auto-discovered site LCN → VC map
│   ├── RawLogDrawer.tsx  # Raw serial output panel (last 200 lines)
│   └── ExportButton.tsx  # CSV and JSON export controls
├── pages/
│   ├── EDACSDashboard.tsx   # EDACS Exclusive (SLERS) layout
│   └── UnifiedDashboard.tsx # EDACS + P25 hybrid layout
└── types/
    └── index.ts          # Shared TypeScript interfaces
```

Keep this structure in sync with the equivalent section in `README.md` when adding or renaming files.

## Coding conventions

The codebase follows these conventions — match them when contributing:

- **TypeScript strict mode** — all code is typed; avoid `any`. Shared interfaces live in `src/types/index.ts`.
- **Functional React components** — no class components. State is managed in `SentinelStore`, not scattered across component-local `useState` calls.
- **Store/decoder separation** — `Decoder.ts` must remain a pure parser with no imports from `SentinelStore` or React. It accepts a string and returns a typed event or `null`. Keep it that way.
- **No external runtime dependencies** beyond `react`, `react-dom`, and `lucide-react` — the output must remain a self-contained HTML file.

## Adding a new agency or talkgroup

All talkgroup-to-agency mappings live in `src/core/AgencyDB.ts` in the `DB` record. Each key is a **decimal string** of the talkgroup ID (the decoder converts hex tokens to decimal with `parseInt(hex, 16).toString()` before lookup). The value shape is:

```typescript
"<decimal-tgid>": { a: "<AGENCY_CODE>", n: "<channel name>" }
```

Example — adding a new Alachua County Sheriff talkgroup:

```typescript
"12303": { a: "LOC", n: "ACSO Dispatch 3" },
```

**Agency codes** must match a key in `AG_COLORS` to receive a color in the UI. Current codes are: `FHP`, `FDLE`, `FWC`, `LOC`, `INT`, `TEC`. If you are adding a new agency category, add a corresponding entry to `AG_COLORS` (and the matching CSS variable in the stylesheet) alongside your `DB` entries.

**Matching existing entries** — when in doubt about decimal vs. hex, look at how nearby entries in the same agency block are keyed and match the pattern exactly. The short numeric entries (e.g. `"11"`, `"78"`) are already in decimal; the long numeric entries (e.g. `"34921"`, `"49937"`) are also decimal.

## Submitting changes

1. Fork the repository and create a descriptive branch (`git checkout -b add-alachua-agencies`).
2. Make your changes. If you are adding talkgroups, verify the decimal IDs against a public reference (RadioReference, scanner codeplug, or observed control channel output).
3. Run `npm run build` and open `dist/index.html` in Chrome to confirm nothing is broken.
4. Open a pull request. Include the source of any new talkgroup data in the PR description.

## License

By contributing you agree that your changes will be released under the [MIT License](LICENSE) that covers this project.

# Wasteland Launcher Diagnostics MVP

Read-only TypeScript CLI for inspecting a 7 Days to Die Mod Organizer 2 workspace.

## Commands

```powershell
npm install
npm test
node dist/cli.js scan --mo2 C:\Modding\MO2 --profile Default
node dist/cli.js conflicts --mo2 C:\Modding\MO2 --profile Default --game "C:\Program Files (x86)\Steam\steamapps\common\7 Days To Die"
node dist/cli.js logs --latest
node dist/cli.js inventory --mo2 C:\Modding\MO2 --profile Default --waka
node dist/cli.js context-pack --mo2 C:\Modding\MO2 --profile Default --out ui\public\context.json
```

All commands accept `--json` except `context-pack`, which already emits JSON or writes it to `--out`.

## React UI

The `ui/` app is the supported local diagnostic viewer for `context-pack` JSON. It does not write to MO2, the game install, a dedicated server, or a remote PC.

```powershell
node dist/cli.js context-pack --mo2 C:\Modding\MO2 --profile Default --out ui\public\context.json
npm run ui:dev
```

Generate `ui/public/context.json` first, then start the Vite UI. The app auto-loads `ui/public/context.json` when that file exists. If it is absent, the app loads bundled sample diagnostics. You can also choose `Load JSON` in the toolbar and select the same `ui/public/context.json` file, or another `context-pack` JSON file.

The Dashboard summarizes the current pack:

- `Candidate groups`: reviewable groups derived from schema v3 `ContextPack.diagnosticGroups`.
- `Exact replay-proven`: groups where replay effects proved a concrete shared target.
- `Unknown risk`: conservative groups from footprint or normalized XPath evidence when exact replay evidence was unavailable.
- `Coverage`: non-ok trace diagnostics such as misses, unsupported operations, parse errors, broad matches, or budget-limited traces.

The Diagnostics view is the schema v3 candidate viewer. It reads only `ContextPack.diagnosticGroups`, hydrates operation references through `ContextPack.operationsById`, joins targeted replay evidence from `ContextPack.trace`, and shows target keys, classification, confidence, operation timeline, and evidence pane. XML identity is no longer based on normalized XPath alone: replay effects carry `targetKey` values such as scalar slots, child slots, and removed node keys. Same-parent `append` and anchored insert operations are retained as order-dependent structural diagnostics because sibling order can be part of the final XML result.

For cache-busting or a production-build check, you can preview a built UI on an alternate local port:

```powershell
npm run ui:preview -- --host 127.0.0.1 --port 5182 --strictPort
```

## Current Scope

- Reads `profiles/<profile>/modlist.txt` as the source of enabled mod order.
- Resolves both direct `ModInfo.xml` roots and nested child mod roots.
- Indexes `Config/*.xml` patch operations and their xpath/path attributes.
- Records DLL filename, size, modified time, and SHA-256 hash.
- Reports XML patch diagnostics from replayed provenance effects, with conservative XPath fallback when vanilla XML cannot be replayed.
- Reads the latest non-empty client log from `%APPDATA%\7DaysToDie\logs`.
- Shows Phase 3 diagnostic groups in the React UI from `ContextPack.diagnosticGroups`, enriched with `ContextPack.trace` replay evidence and provenance target keys.

The MVP does not write to MO2, the game install, a dedicated server, or a remote notebook server. The only write path is `context-pack --out`.

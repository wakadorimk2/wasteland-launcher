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
node dist/cli.js context-pack --mo2 C:\Modding\MO2 --profile Default --out _analysis\wasteland-context.json
node dist/cli.js visualize --input _analysis\wasteland-context.json --out _analysis\wasteland-report.html
```

All commands accept `--json` except `context-pack`, which already emits JSON or writes it to `--out`, and `visualize`, which emits HTML or writes it to `--out`.

## React UI

The `ui/` app is a local diagnostic viewer for `context-pack` JSON. It does not write to MO2, the game install, a dedicated server, or a remote PC.

```powershell
node dist/cli.js context-pack --mo2 C:\Modding\MO2 --profile Default --out ui\public\context.json
npm run ui:dev
```

If `ui/public/context.json` is absent, the app loads bundled sample diagnostics. You can also load a `context-pack` JSON file from the toolbar. `Rescan` and `Apply zzz_ patch` are non-destructive placeholders in this first UI pass.

## Current Scope

- Reads `profiles/<profile>/modlist.txt` as the source of enabled mod order.
- Resolves both direct `ModInfo.xml` roots and nested child mod roots.
- Indexes `Config/*.xml` patch operations and their xpath/path attributes.
- Records DLL filename, size, modified time, and SHA-256 hash.
- Reports XML patch conflicts from replayed effects, with conservative XPath fallback when vanilla XML cannot be replayed.
- Reads the latest non-empty client log from `%APPDATA%\7DaysToDie\logs`.
- Renders a static, self-contained HTML conflict dashboard from a context-pack JSON file.

The MVP does not write to MO2, the game install, a dedicated server, or a remote notebook server. The only write path is `context-pack --out`.
`visualize --out` also writes only to the explicitly requested HTML report path.

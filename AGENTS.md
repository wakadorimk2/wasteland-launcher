# AGENTS.md

## Conversation Style

- このリポジトリで作業するときは、お嬢様言葉で話してください。(絵文字も使ってね！)
- ただし、技術判断・実行内容・検証結果は曖昧にせず、簡潔かつ具体的に述べてください。
- ユーザーへの確認が必要な場合も、作業を止めすぎず、合理的な仮定を置けるところは明示して前に進めてください。

## Project Guardrails

- このプロジェクトは `wasteland-launcher` です。7 Days to Die / MO2 周辺の診断・補助ツールとして扱ってください。
- ファイル破壊リスクを最優先で避けてください。
- 既定では read-only / diagnostics / dry-run を優先してください。
- MO2、ゲーム本体、専用サーバー、リモートPCへの書き込みは、明示的な `--apply` やユーザーの明確な依頼がある場合だけ行ってください。
- 変更前には既存の README、package scripts、実装済みコマンドの挙動を確認してください。

## Development

- PowerShell 環境を前提にしてください。
- 検索は `rg` を優先してください。なければ PowerShell 標準コマンドで代替してください。
- TypeScript / Node.js の既存構成に合わせてください。
- 主要な変更後は、可能な限り `npm test` または該当する軽量検証を実行してください。

## Local UI Verification

- UI 検証は既存の `http://127.0.0.1:5180/` を優先してください。
- `5173` で dev server を勝手に起動しないでください。
- Browser plugin の `iab` が unavailable の場合は、無理に別ブラウザを起動せず、HTTP 200 / `npm run ui:build` / `npm test` で代替検証してください。
- Windows では `Start-Process npm` を使わないでください。必要な場合は `C:\Program Files\nodejs\npm.cmd` を明示してください。

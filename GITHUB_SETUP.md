# GitHub Pages 公開手順 — Live Manager v4.3

このv4.3は、TicketDive専用Workerを最初から設定済みです。

## 利用者側の設定は不要

公開Worker:

`https://live-manager-ticketdive.47frzzcfhy.workers.dev`

このURLはアプリ内部に設定済みです。
Live Managerを使う人が「TicketDive専用Worker URL」を入力する必要はありません。

## GitHubへ更新する方法

1. `live-manager-v4.3-public-auto-ticketdive.zip` を解凍します。
2. GitHubでLive Managerを公開しているリポジトリを開きます。
3. `Add file` → `Upload files` を開きます。
4. ZIPを解凍した中身をリポジトリのルートへ上書きアップロードします。
5. `Commit changes` を押します。
6. GitHub Pagesの更新後、ブラウザで `Ctrl + Shift + R` を押して強制再読み込みします。

GitHub Pages設定は通常:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/(root)`

## 一般ユーザーの使い方

Live Managerで

`その他 → ライブURL取り込み`

を開き、TicketDiveのイベントURLを貼って「URLから取得」を押すだけです。

Worker URLの入力、Worker接続テスト、初期設定は不要です。

## Cloudflare Workerについて

現在のWorkerは削除しないでください。

Workerを別URLへ変更した場合だけ、`app.js` の

`PUBLIC_TICKETDIVE_WORKER_URL`

を変更してGitHub Pagesへ再公開してください。

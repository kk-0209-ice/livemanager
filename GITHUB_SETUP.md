# Live Manager v4.1 - GitHub Pages + TicketDive Worker 設定

## 1. GitHubへアップロード
リポジトリのルートに、このZIP内のファイルをアップロードします。
最低限必要:
- index.html
- app.css
- app.js
- manifest.json
- sw.js
- icon.svg
- .nojekyll

## 2. GitHub Pages
GitHubリポジトリ:
Settings → Pages

Build and deployment:
- Source: Deploy from a branch
- Branch: main
- Folder: /(root)

Saveを押します。

## 3. Cloudflare Workerを作る
Cloudflare:
Workers & Pages → Create application → Worker

`server/ticketdive-api-worker.js` の内容をWorkerのコードへ全部貼り付け、
Deployします。

発行された workers.dev のURLをコピーします。

## 4. Worker確認
Worker URLの末尾へ `/health` を付けて開きます。

以下が表示されれば正常:
{"ok":true,"service":"live-manager-ticketdive-v4"}

## 5. Live Managerへ設定
GitHub Pagesで公開したLive Managerを開きます。

その他 → 外部連携設定 → TicketDive専用Worker URL

へWorkers URLを貼り付けます。

「Worker接続テスト」を押します。

成功例:
接続成功：iii! / 出演者 3組（iON! / iMiN! / iLiFE!）

その後「保存」を押します。

## 6. TicketDive URLを試す
ライブ追加 → URLから取り込み
TicketDiveイベントURLを貼り付けます。

解析結果の取得元が
- TicketDive専用Worker
なら成功です。

`TicketDive Reader` と出る場合はWorkerが未設定、または接続失敗しています。

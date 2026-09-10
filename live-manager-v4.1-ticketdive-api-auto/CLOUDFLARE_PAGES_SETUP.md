# Cloudflare Pages版（出演者取得を設定ゼロで使う）

Live Manager v4.1には `functions/api/ticketdive.js` が入っています。

Cloudflare Pagesへ **Git連携またはWranglerでデプロイ**すると、
アプリは自動的に同一サイト内の `/api/ticketdive` を利用します。

この場合、「外部連携設定」のWorker URLは空欄のままで構いません。

## GitHub Pagesとの違い

GitHub Pagesは静的ファイルしか実行できないため、
`functions/api/ticketdive.js` のようなサーバー処理は動きません。

GitHub Pagesを継続する場合は、ZIP内の

`server/ticketdive-api-worker.js`

をCloudflare Workersへ1回デプロイし、
Live Managerの「その他 → 外部連携設定」にそのURLを設定してください。

## 確認方法

TicketDive URLを読み込んだときの解析結果に

`Cloudflare Pages内蔵TicketDive API`

または

`TicketDive専用Worker`

と表示されればAPI経由です。

`TicketDive Reader`

と表示されている場合はAPI未接続で、
TicketDive Readerから基本情報だけを取得している状態です。

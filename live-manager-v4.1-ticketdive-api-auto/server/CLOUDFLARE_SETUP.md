# TicketDive専用Cloudflare Worker セットアップ

Live Manager v4では、TicketDive出演者を安定取得するために専用Workerを使用します。

## 方法A: Cloudflare管理画面から（簡単）

1. Cloudflareへログイン
2. **Workers & Pages** → **Create** → **Worker**
3. Workerを作成
4. ZIP内の `server/ticketdive-api-worker.js` の内容をWorkerエディタへ貼り付け
5. Deploy
6. 発行されたURLをコピー  
   例: `https://live-manager-ticketdive.xxxxx.workers.dev/`
7. Live Managerを開く
8. **その他 → 外部連携設定**
9. **TicketDive専用Worker URL** にURLを貼り付け
10. **Worker接続テスト** を押す
11. 「接続成功」と出演者が表示されたら保存

URLは以下のどちらでも構いません。

- `https://live-manager-ticketdive.xxxxx.workers.dev/`
- `https://live-manager-ticketdive.xxxxx.workers.dev/?url={url}`

## 方法B: Wrangler

`server` フォルダで:

```bash
npm install
npm run deploy
```

表示された workers.dev URLをLive Managerへ設定します。

## 動作確認

Worker URLの末尾に `/health` を付けると:

```json
{"ok":true,"service":"live-manager-ticketdive-v4"}
```

が返ります。

TicketDive取得例:

```text
https://YOUR-WORKER.workers.dev/?url=https%3A%2F%2Fticketdive.com%2Fevent%2Fiii-260920
```

成功時は公演情報と出演者がJSONで返ります。

## セキュリティ

このWorkerは以下だけを許可します。

- HTTPS
- `ticketdive.com` / `www.ticketdive.com`
- `/event/` から始まる公開イベントURL
- GETのみ

ログイン、購入、Cookie転送、認証情報の取得は行いません。

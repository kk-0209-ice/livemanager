# Live Manager v4.1

## 重要な修正

v3ではGitHub Pages等からTicketDiveへ直接 `fetch()` していたため、ブラウザのCORS制限でURLを貼っても取得できない環境がありました。v3.3ではTicketDiveの公開イベントURLについて、以下の順で自動取得します。

1. 「外部連携設定」で設定した自分のプロキシ（設定済みの場合）
2. Jina Readerによる公開ページ取得（標準フォールバック）
3. TicketDiveへの直接取得（可能な環境のみ）

取得結果から **公演名 / 公演日 / 会場 / 開場 / 開演 / 出演** を解析して登録候補を表示します。取得中・成功・失敗の状態も画面に表示します。

### GitHub Pages更新時
旧Service Workerのキャッシュで古いv3が残る問題を避けるため、v3.3ではキャッシュ名を変更し、HTML/JS/CSSをネットワーク優先にしています。GitHubへ上書き後、一度ページを再読み込みしてください。

### プライバシー
標準フォールバックを使う場合、入力した**公開イベントURL**がJina Readerへ送信されます。ログイン情報、購入情報、Cookieは送信しません。自分のCloudflare Workerを設定した場合はそちらを優先します。

---


「ライブ・チェキ管理アプリ 完全仕様書」「要件定義書」をもとに、v2をさらに拡張したスマートフォンファーストのWebアプリです。

## v3で追加した主な機能

### ライブURL / TicketDive取り込み補助
- ライブURL入力画面
- TicketDive形式の「公演日時 / 開場時刻 / 開演時刻 / 会場 / 出演」を解析
- 取得結果を確認してライブとして登録
- CORSで直接取得できない場合の「ページ本文貼り付け解析」
- 自分のURL取得プロキシを設定可能
- Cloudflare Workers用の安全なTicketDive限定プロキシ例を同梱
- TicketDiveのログイン・購入・認証などは自動操作しません

### Googleカレンダー
- ライブ詳細からGoogleカレンダーの予定追加画面を開く
- 公演名 / 日時 / 会場 / URL / メモを引き継ぐ
- `.ics` ファイル出力にも対応

### Kアリーナ横浜 座席マップ
- LEVEL 3 / LEVEL 5 / LEVEL 7対応
- ブロック / 列 / 番号入力
- アプリ内に座席位置の簡易ピンを表示
- ライブ詳細の座席情報へ保存
- Kアリーナ公式シートマップへの確認リンク

注意: 内蔵ピンは「位置を把握しやすくする簡易ガイド」です。公演ごとに座席構成が変わる場合があるため、最終確認は公式シートマップとチケット記載内容を使用してください。

### 複数チェキ一括スキャン
- 1枚の写真から白いチェキ候補領域を簡易検出
- 最大20候補を表示
- 枠をタップして保存対象 / 除外を切り替え
- 選択した候補を個別JPEGとして一括保存
- 各画像へメンバー / イベント / 日付 / 種類を関連付け
- 既存のチェキ通し番号・アルバムへ自動連携

### AIメンバー候補
- イベントのグループ情報から候補を絞るローカル補助
- 任意の自作AI API Endpointを設定可能
- APIへ画像縮小データと候補メンバー一覧をPOST
- `{ "memberId": "...", "confidence": 0.95 }` の形式で候補を受け取る設計
- OpenAI等の秘密APIキーをブラウザへ直接保存しない構成を推奨

### クラウド同期
- Supabase Auth（メール / パスワード）ログイン
- ライブ / チケット / 座席 / チェキ記録 / 費用 / 設定のクラウド保存・復元
- チェキ画像をSupabase Storageへ同期可能
- Row Level Security前提
- `supabase_setup.sql` を同梱

## v1 / v2から引き続き利用できる機能

- ホーム / NEXT LIVE / ダッシュボード
- ライブ登録・編集・削除・一覧・詳細
- 複数チケット申込、当落、支払い、発券状態
- 座席、特典会、同行者、カレンダー
- グループ / メンバー / 推し設定
- 今日のチェキ（-1 / +1 / +3 / +5）
- 現場モード
- チェキ標準単価・累計・金額集計
- 単体チェキスキャン / 四隅調整 / 台形補正
- 連続スキャン
- IndexedDB画像保存
- チェキアルバム / 詳細 / お気に入り
- チェキ通し番号
- スキャン進捗
- マイルストーン
- チェキ券・特典券
- 費用 / 統計 / ランキング / 検索
- 通知補助
- 画像込みJSONバックアップ / 復元
- PWA簡易オフライン対応
- v1 / v2 localStorageからの移行

## GitHub Pagesで使う

ZIP内のファイルをGitHubリポジトリ直下へアップロードし、Pagesを有効にすれば基本機能を使用できます。

URLの直接取得だけは、外部サイト側のCORS設定によってGitHub Pagesから取得できない場合があります。その場合でも本文貼り付け解析は利用できます。

## TicketDive URLを直接読み込みたい場合

`server/ticketdive-proxy-worker.js` をCloudflare Workersへ配置してください。

配置後、アプリの「その他 → 外部連携設定 → URL取得プロキシ」に以下の形式で設定します。

```
https://YOUR-WORKER.workers.dev/?url={url}
```

このサンプルWorkerは `ticketdive.com` のHTTPS URLだけを許可しています。

## Supabaseクラウド同期

1. Supabaseプロジェクトを作成
2. Email Authenticationを有効化
3. ユーザーを作成
4. SQL Editorで `supabase_setup.sql` を実行
5. アプリの「その他 → クラウド同期」にProject URL / Anon Key / メールを設定
6. ログイン
7. 「この端末 → クラウド」で保存
8. 別端末でログイン後「クラウド → この端末」で復元

RLSを無効化した状態で運用しないでください。

## ローカル起動

```bash
python -m http.server 8000
```

`http://localhost:8000/` を開きます。



## v3.3 TicketDive公演名修正

Jina Readerがイベント画像を `![Image ...](...)` として本文先頭へ出力する場合に、その画像Markdownを公演名として誤認識する問題を修正しました。

公演名の判定は、ReaderのTitleメタ情報を最優先し、次に「公演日時」直前の有効な本文行を使用します。画像Markdown、画像URL、背景画像、`_next/image`、Google Cloud Storage画像URLはタイトル候補から除外します。`iii!` のような短いタイトルもそのまま認識できます。

## TicketDive 出演者の自動取得（v3.3）

TicketDiveイベントURLからページ内の「出演」「出演者」「出演アーティスト」欄を検出し、出演者全員をアーティスト名として自動登録します。

例: `出演 iON! / iMiN! / iLiFE!` → アーティスト名 `iON! / iMiN! / iLiFE!`

出演者が1組だけで、その名前と既存グループ名が一致する場合はグループも自動で紐付けます。


## v3.5 TicketDive 出演者取得修正

TicketDive/Jina Readerが出演者をMarkdownリンクの別行として返すケースに対応しました。

対応例:

```text
出演
[iON!](...)
[iMiN!](...)
[iLiFE!](...)
TICKET INFO
```

この場合も `iON! / iMiN! / iLiFE!` として取得します。Markdown表形式、箇条書き、`出演iON! / ...` の同一行形式にも対応します。


## v3.5 TicketDive出演者取得の再修正

- 最初のReader結果に出演者欄だけ含まれない場合、出演者専用の再取得を自動実行します。
- 再取得は Jina Reader のキャッシュ無効ブラウザレンダリング → AllOrigins HTML → 直接取得の順で試します。
- 取得できた出演者は解析結果だけでなく「取得できない場合の手動解析」の本文欄にも `出演：...` として自動挿入します。
- URL取得画面に「出演者取得」専用ステータスを追加しました。
- `iii!` のようなイベントで `iON! / iMiN! / iLiFE!` を解析できる形式を回帰テストに追加しました。


## v3.6 TicketDive出演者取得の追加対策

TicketDiveの一部イベントでは、Jina Reader等で取得した本文に「出演」欄だけ含まれないことがあります。
v3.6では以下の順に出演者を探索します。

1. 取得本文の `出演 / 出演者 / 出演アーティスト`
2. TicketDive HTML内の JSON-LD / `__NEXT_DATA__` / Next.js hydration data
3. キャッシュ無効Reader / HTML再取得
4. Google / Bing / Yahoo! の公開検索インデックスに表示されるTicketDiveイベント情報

URLを貼り付けると自動取得を開始します。
検索インデックス補完は、公演名・日付・会場・イベントURLを照合して同じ公演の候補を優先します。

### 注意
検索インデックスはTicketDive本体より更新が遅れる場合があります。
出演者変更があった公演では、最終確認はTicketDive公式ページを優先してください。


## v3.7 出演者数の誤カウント修正

TicketDive検索結果や構造化データに含まれる項目ラベル
`アーティスト / 出演 / 出演者 / ARTIST / CAST`
などを、実際の出演者として数えないよう修正しました。

例:

修正前:
`アーティスト / 出演 / iON! / iMiN! / iLiFE!` → 5組

修正後:
`iON! / iMiN! / iLiFE!` → 3組


## v3.8 TicketDive出演者取得の安定化

出演者は次の順で探索します。

1. TicketDive HTML内の `/artist/...` リンク
2. JSON-LD / `__NEXT_DATA__` / Next.js hydration data
3. ページ本文の `出演 / 出演者 / 出演アーティスト`
4. 設定済みの自前プロキシ
5. corsproxy.io / CodeTabs / isomorphic-git / Jina Reader / AllOrigins
6. 公開検索インデックス

また `アーティスト 出演 iON! / iMiN! / iLiFE!` のように
ラベルが連続しても、ラベルだけ除外して3組として扱います。


## v3.9 出演者読み込み高速化

v3.8までは出演者取得先を順番に試していたため、失敗する取得先のタイムアウト待ちで時間がかかる場合がありました。

v3.9では以下を変更しています。

- HTML取得系を並列実行
- 検索インデックス系も並列実行
- HTML系と検索系も同時実行
- 最初に出演者を取得できた結果を即採用
- 各補助取得のタイムアウトを約6.5秒へ短縮
- TicketDive URLごとに出演者を6時間キャッシュ
- 同じURLを再度読み込んだ場合はキャッシュから即時表示

公演情報本体の取得後に出演者補完が必要なケースでも、以前のように複数の18〜20秒タイムアウトを順番に待つことはありません。


## v4.0 TicketDive連携の根本修正

v3系ではGitHub Pagesのブラウザから無料CORSプロキシやReaderを経由してTicketDiveを取得していました。
この方式では出演者だけ欠落する、取得が遅い、外部サービスの状態で動作が変わる問題がありました。

v4では **Live Manager専用Cloudflare Worker** を使用できます。

- WorkerがTicketDiveをサーバー側で取得
- 通常ブラウザUA / Googlebot UAを並列取得して差を吸収
- `/artist/...` リンクを最優先で出演者として抽出
- Next.js埋め込みデータも解析
- 本文の「出演」欄も解析
- Worker側で結果を統合
- Live Managerには完成済みJSONを1回だけ返す
- 5分Workerキャッシュ + 6時間ブラウザ出演者キャッシュ
- GitHub Pages側のCORS問題を回避

設定方法は `server/CLOUDFLARE_SETUP.md` を参照してください。


## v4.1 重要: 「TicketDive Reader」と出る場合

`TicketDive Reader` は出演者取得用の専用APIではありません。
公演名・日付・会場は取れても、出演者欄だけ欠落する公演があります。

v4.1では以下の2方式に整理しました。

### Cloudflare Pages
`functions/api/ticketdive.js` を自動使用します。外部連携設定は不要です。

### GitHub Pages
静的ホスティングのためAPIを内蔵できません。
`server/ticketdive-api-worker.js` をCloudflare Workersへデプロイし、
「その他 → 外部連携設定」にWorker URLを設定してください。

解析結果の取得元が
`Cloudflare Pages内蔵TicketDive API` または `TicketDive専用Worker`
になっていることを確認してください。


---

# v4.3 公開版 TicketDive自動連携

TicketDive Workerは次のURLをアプリに組み込み済みです。

`https://live-manager-ticketdive.47frzzcfhy.workers.dev`

一般ユーザーはWorker URLを入力する必要がありません。
「ライブURL取り込み」にTicketDiveイベントURLを貼るだけで使用できます。

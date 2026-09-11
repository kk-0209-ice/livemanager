# v4.3

- TicketDive Workerを公開版へ自動設定
- 固定Worker: `https://live-manager-ticketdive.47frzzcfhy.workers.dev`
- 「TicketDive専用Worker URL」入力欄を一般ユーザー向け画面から削除
- Worker初期設定・接続テストを不要化
- TicketDive URL取り込み画面を公開版向けに変更
- Service Workerキャッシュをv4.3へ更新

# CHANGELOG

## v4.1
- Cloudflare Pages Functions `/api/ticketdive` を追加
- Cloudflare PagesではWorker URL設定なしでTicketDive APIを自動使用
- GitHub Pagesでは専用Workerが必要であることを画面上に明示
- `TicketDive Reader` を出演者取得成功経路と誤認しない表示へ変更
- API未接続時の出演者エラー文を具体化
- 同一オリジンAPI → 設定済みWorker → Readerの優先順に変更
- GitHub Pages上で不安定な多重出演者フォールバックを停止
- Service Workerキャッシュをv4.1へ更新

## v4.0
- TicketDive取得を専用Cloudflare Worker JSON API方式へ変更
- GitHub PagesからTicketDiveを直接/無料プロキシ経由で読む不安定さを解消
- Workerで通常UAとGooglebot UAを並列取得
- `/artist/...` リンクを最優先で出演者抽出
- Next.js埋め込みデータ・本文出演欄も解析
- Worker側5分キャッシュ
- Live Manager側Worker接続テストを追加
- Worker未設定/失敗時のみ旧公開取得へフォールバック
- Service Workerキャッシュをv4.0へ更新

## v3.9
- TicketDive出演者取得を逐次処理から並列処理へ変更
- HTML/埋め込みデータ系と検索インデックス系を同時実行
- 最初に成功した出演者データを即採用
- 補助取得タイムアウトを約6.5秒へ短縮
- URL単位の出演者キャッシュ（6時間）を追加
- 同一URL再取得を高速化
- Service Workerキャッシュをv3.9へ更新

## v3.8
- TicketDiveの `/artist/...` リンクをHTMLから直接抽出
- SSR HTML・escaped Next.js HTMLにも対応
- `アーティスト 出演 ...` の連続ラベルを繰り返し除去
- 自前プロキシ / corsproxy.io / CodeTabs / isomorphic-git / Jina / AllOrigins の複数経路を追加
- 取得後に最終正規化を必ず実行
- 出演者ステータスに「3組」など件数を表示
- Service Workerキャッシュをv3.8へ更新

## v3.7
- TicketDive出演者抽出で「アーティスト」「出演」を出演者として数える不具合を修正
- 「出演者」「出演者名」「出演アーティスト」「ARTIST」「PERFORMER」「CAST」等のラベル単独トークンも除外
- 抽出直後と最終確定時の二段階でラベルを除外
- `アーティスト / 出演 / iON! / iMiN! / iLiFE!` を `iON! / iMiN! / iLiFE!` の3組として扱う
- Service Workerキャッシュをv3.7へ更新

## v3.6
- TicketDive本文から出演者だけ欠落するケースを修正
- Next.js / JSON-LD / hydration data から出演者を抽出
- Google / Bing / Yahoo! 検索インデックスから出演者を自動補完
- 公演名・会場・日付・event slugで検索候補をスコアリング
- TicketDive URL貼り付け後に自動取得を開始
- 自前Cloudflare WorkerのUser-Agentをクローラ互換へ変更
- Service Workerキャッシュをv3.6へ更新

# v3.5

- TicketDiveの出演者だけ欠落する取得結果に対し、別経路で自動再取得する処理を追加。
- 取得した出演者を手動解析用本文にも自動表示。
- 出演者専用ステータス表示を追加。
- Jina Readerのキャッシュ無効化/ブラウザレンダリング、AllOrigins HTML取得をフォールバックに追加。

# v3.4

- TicketDive/Jina Readerで出演者がMarkdownリンクの別行になる場合に取得できない不具合を修正
- `[iON!](URL)` のようなリンクから表示名を出演者として抽出
- `出演` ラベル単独行 + 複数出演者行に対応
- Markdown表形式・箇条書き形式にも対応
- 画像Markdown・画像URLは出演者候補から除外
- `iii!` の実ページ形式 `出演iON! / iMiN! / iLiFE!` にも引き続き対応

# Changelog

## v3.3

- TicketDiveの「出演」「出演者」「出演アーティスト」欄を自動検出
- 複数出演者を ` / ` 区切りで全件取得
- URL取り込み時に出演者全員を「アーティスト名」へ自動反映
- `iii!` ページの `iON! / iMiN! / iLiFE!` 形式に対応
- 「出演」ラベルと出演者が別行の場合にも対応
- 全角スラッシュ、読点、カンマ区切りにも対応
- 解析結果に出演者数を表示
- 出演者が1組かつ既存グループ名と一致する場合はグループも自動紐付け
- Service Workerキャッシュをv3.3へ更新

## v3.2

- TicketDive URL取り込みで背景画像Markdownを公演名として誤認識する不具合を修正
- `![Image ...](...)`、画像URL、`_next/image`、Google Cloud Storage画像URLをタイトル候補から除外
- Jina Reader の `Title:` メタ情報を優先利用
- `Title:` が使えない場合は「公演日時」直前の有効テキストを優先
- `iii!` のような短い・記号を含む公演名に対応
- Service Worker のキャッシュ名とアセットバージョンを v3.2 に更新

# Changelog

## v3.1
- TicketDive URL取得がCORSで失敗する問題を修正
- TicketDive公開URLはJina Readerを自動フォールバックとして利用
- URL取得の成功/失敗理由を画面表示
- TicketDive向けパーサーを強化
- Enterキー取得とURL貼り付け認識を追加
- Service Workerを更新し、古いapp.jsが残りにくい方式へ変更

## v3
- ライブURL取り込み画面
- TicketDiveテキスト解析
- 外部URLプロキシ設定
- Google Calendar追加リンク
- ICS出力
- KアリーナLEVEL 3/5/7簡易座席ガイド
- 複数チェキ一括検出・保存
- AIメンバー候補API連携口
- Supabase Auth / DB / Storageクラウド同期
- v2/v1データ移行

## v2
- 現場モード
- 単体チェキスキャン
- アルバム
- チェキ番号
- スキャン進捗
- チェキ券
- 通知・画像込みバックアップ

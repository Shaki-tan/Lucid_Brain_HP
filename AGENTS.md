# コーディング規約

## 第1部 記述層

各言語のエコシステム標準に従う。言語を跨いだ命名規則の統一は行わない。

| 階層 | 言語 | 記述範囲 |
|---|---|---|
| 主要言語 | Python / TypeScript（JavaScript を含む）/ Rust / R / SQL / HTML・CSS | 該当する全項目 |
| 登録言語 | Go / C・C++ / Java・Kotlin / Swift / Shell | 命名とフォーマットのみ。使用開始時に追加する |

主要言語は性質が一様ではない。**各章の L3 は、その章に該当する言語のみを扱う。該当しない言語は章末に1行で明示する。**

| 言語 | 性質 | 主に該当する章 |
|---|---|---|
| Python / TypeScript / Rust | 汎用の手続き型・型システムを持つ | 全章 |
| R | 動的型付け。分析用途が中心 | 第1部 / 2.1 / 2.4〜2.9 |
| SQL | 宣言的。制約が型の役割を担う | 第1部 / 2.2 / 2.3 / 2.6 |
| HTML・CSS | 宣言的。実行フローを持たない | 第1部 / 第3部 |

### 1.1 命名

**L1** — 名前はコードの大半を占める。読み手が意味を推測せずに済むことを優先する。エコシステム標準に従うのは、その言語の読み手にとって推測が最も少ないためである。

**L2**

- 短く保つ。略語を許容する
- 不要な副詞・接続詞は使わない
- 単語の羅列だけで意味が伝わることを基準とする
- 環境変数は UPPER_SNAKE_CASE とする。言語によらず統一する
- 固有名詞・一般名詞は原語の表記に準拠する（`Shakitan`, `SQL`, `SQLite`, `GitHub`）
- boolean を保持する変数・boolean を返す関数には、`is` / `has` / `can` / `should` のいずれかを prefix として付ける
- **ファイル名・ディレクトリ名は ASCII とする。日本語を使わない**
- **ディレクトリ名は、エコシステムが定めるもの（`src/`, `tests/`, `scripts/` 等）はその標準に従う。プロジェクトが独自に作る文書ディレクトリは PascalCase とする**（`Docs/`, `Docs/SOW/`）
- **常設の文書ファイルは UPPER_SNAKE_CASE とする**（`SPEC.md`, `AGENTS.md`, `README.md`, `DECISIONS.md`）。蓄積されるファイルは用途ごとの規則に従う（SOW は `YYYYMMDD_hhmmss_<内容>.md`）
- 数式由来の変数名は、上記「単語の羅列だけで意味が伝わる」の例外とする。1.3 に従い、原典との対応をコメントに記載する

**L3 — Python**

| 対象 | 規則 | 例 |
|---|---|---|
| 変数・関数 | snake_case | `num_data`, `get_task_overview` |
| 定数 | UPPER_SNAKE_CASE | `MAX_RETRY` |
| クラス | PascalCase | `TaskManager` |
| モジュール・ファイル | snake_case | `ask_model.py` |

**L3 — TypeScript / JavaScript**

| 対象 | 規則 | 例 |
|---|---|---|
| 変数・関数 | camelCase | `taskList`, `getTask` |
| 型・interface | PascalCase | `TaskItem`, `ChatMessage` |
| 定数 | UPPER_SNAKE_CASE | `MAX_RETRY` |
| ファイル | camelCase | `chatService.ts` |

**L3 — Rust**

| 対象 | 規則 | 例 |
|---|---|---|
| 変数・関数 | snake_case | `num_data`, `get_task` |
| 型・構造体・enum・トレイト | PascalCase | `TaskItem`, `Status`, `Repository` |
| 定数・static | UPPER_SNAKE_CASE | `MAX_RETRY` |
| クレート・モジュール | snake_case | `task_manager` |
| マクロ | snake_case | `try_parse!` |
| ライフタイム | 短い小文字 | `'a`, `'src` |
| ファイル | snake_case | `task_manager.rs` |

**L3 — R**

| 対象 | 規則 | 例 |
|---|---|---|
| 変数・関数 | snake_case | `num_data`, `calc_mean` |
| 定数 | UPPER_SNAKE_CASE | `MAX_ITER` |
| S4 / R6 クラス | PascalCase | `DataModel` |
| ファイル | snake_case | `preprocess.R` |

**L3 — SQL**

| 対象 | 規則 | 例 |
|---|---|---|
| 予約語 | UPPER_CASE | `SELECT`, `WHERE`, `JOIN` |
| テーブル名 | snake_case（複数形） | `tasks`, `chat_sessions` |
| カラム名 | snake_case | `created_at`, `task_id` |
| インデックス | `idx_テーブル_カラム` | `idx_tasks_status` |

**L3 — HTML / CSS**

| 対象 | 規則 | 例 |
|---|---|---|
| id | camelCase | `taskDetail` |
| class（通常 CSS） | kebab-case | `task-detail-modal` |
| class（Tailwind） | ユーティリティクラスをそのまま使用 | `flex items-center` |
| CSS 変数 | kebab-case | `--color-primary` |
| データ属性 | kebab-case | `data-task-id` |

**L3 — 登録言語**

Go / C・C++ / Java・Kotlin / Swift / Shell の表は元規約のまま。使用開始時に主要言語へ昇格させる。

### 1.2 フォーマット

**L1** — 記述の揺れは差分のノイズになり、レビューの対象を見失わせる。プラットフォームやフレームワークを跨ぐと、揺れは事故になる。統一された記述は、読む速度を上げる。

**L2**

- 同一プロジェクト内で記述を揺らさない
- フォーマッタの設定を本章の表と一致させる
- フォーマットエラーがある状態でコミットしない

**L3**

**L3 — 主要言語**

| 項目 | Python | TS/JS | Rust | R | SQL | HTML | CSS |
|---|---|---|---|---|---|---|---|
| インデント | 4sp | 2sp | 4sp | 2sp | 2sp | 2sp | 2sp |
| セミコロン | N/A | なし | あり | N/A | あり（文末） | N/A | あり |
| クォート | double | single | double | double | single（文字列） | double（属性値） | double |
| フォーマッタ | `ruff format` | `prettier` | `cargo fmt` | `styler` | `sqlfluff` | `prettier` | `prettier` |

**L3 — 登録言語**

| 項目 | Go | C/C++ | Java/Kotlin | Swift | Shell |
|---|---|---|---|---|---|
| インデント | tab | 4sp | 4sp | 4sp | 2sp |
| セミコロン | なし | あり | あり | なし | N/A |
| クォート | double | double | double | double | double |

**注記** — Go の tab、Rust / C / Java のセミコロン等は言語仕様上必須のため変更不可。TS/JS は HTML/JSX との棲み分けのため single を採用する。SQL の文字列リテラルは標準 SQL で single が必須である。



## 第3部 UI層

### 3.1 共通

**L1** — UI は人間だけが操作するものではない。自動テスト・支援技術・他のプログラムからも操作される。見た目や整形の中にしか存在しない情報は、それらから不可視である。

**L2**

- 操作可能な対象は、それぞれ一意に同定できる名前を持つ。同一文脈内で名前が重複しないこと
- 名前は決定的である。同じ状態なら同じ名前になる。実行のたびに規則なく変わる名前を作らない
- 状態は、見た目や整形とは独立した機械可読な形で公開する
- 名前に動的テキスト（件数・日時・ユーザー名）を含める場合、そのパターンを SPEC.md に記載する

**注記** — 「実体には表示文字列と独立した安定した識別子を持たせる」は 2.3 に置く。UI 固有ではなくデータモデリングの規則であるため。

### 3.2 GUI

**L1** — 共通の L1 に加えて。要素ツリーに現れない情報は、存在しないものとして扱われる。見た目を作ることと、要素として存在させることは別の作業である。

**L2 — 要素の種別**

- 操作可能な要素は、プラットフォーム標準の対話要素を使う。汎用コンテナ要素（`div`, `span` 等）に操作ハンドラを付けない
  - 例外: ドラッグ領域、スクロールコンテナ、描画面上の当たり判定など、標準要素では表現できない操作。この場合は役割と名前を明示的に付与する
- 標準要素の見た目のみを変更することは可
- 独自描画UI（Canvas, WebGL 等）を使う場合は、要素情報を公開する処理を実装する

**L2 — 名前**

- 図記号のみで文字を持たない操作要素には、必ずアクセシブル名を与える
- 同一画面内で「役割 + 名前」の組が一意になるようにする。同名が並ぶ場合は文脈を含めた名前を与える

**L2 — 状態**

- 無効・選択・展開・処理中の状態は、状態属性として公開する。見た目のみで表現しない
- アニメーションと自動再生は、利用者のモーション設定に従って停止できるようにする。停止できない無限アニメーションを作らない

**L2 — 画面の同定**

- 画面の状態を外部から一意に同定できるようにする。ディープリンクと状態復元が可能な形にする

**L3**

| 項目 | Web / Electron renderer | ネイティブ（将来） |
|---|---|---|
| 状態の公開 | `aria-disabled` / `aria-selected` / `aria-expanded` / `aria-busy` / `aria-live` | プラットフォームのアクセシビリティ API |
| モーション設定 | `prefers-reduced-motion` | OS のモーション設定 |
| 画面の同定 | ルーティング（URL / ルート識別子） | 画面識別子 |
| 検査 | axe-core / eslint-plugin-jsx-a11y | — |

**検証（必須）** — 操作要素の役割・名前の欠落と、同一画面内の名前重複を検出する。
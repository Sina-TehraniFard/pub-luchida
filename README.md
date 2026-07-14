# Luchida — ルール駆動FX自動売買システム

FXで一番難しいのは、相場を読むことではなく「自分で決めたルールを、自分で守ること」でした。ならば意志の強さに頼らず、**意志が介入できない構造**を作ればいい——それが Luchida です。ルールの条件が成立したときだけ取引し、それ以外のときは何もしません。

```mermaid
flowchart LR
    FX["💹 為替レート<br/>WebSocketでリアルタイム受信"] --> Rule{"📏 ルール判定"}
    Rule -->|条件成立| Order["📤 注文を実行"]
    Rule -->|不成立| Wait["😴 何もしない<br/>（ここが一番大事）"]
    BT["🧪 自作バックテストエンジン<br/>20年分・14億行のtickデータ"] -.->|検証を通ったルールだけが本番へ| Rule
```

> **免責事項** 本リポジトリは個人の技術検証を目的としたもので、投資助言・投資勧誘ではありません。FXには元本を失うリスクがあります。収益性を保証・示唆するものではなく、運用成績・損益は一切公開していません。

## 30秒でわかる Luchida

- ルール成立時のみ取引するFX自動売買システム。**要件定義から運用・保守まで「1人 + AI」で実施**
- 売買ルールは自作バックテストエンジンで統計検証してから本番投入
- PM2 で24時間常駐。監視・自動復旧・緊急全決済まで運用設計済み
- 本業は Java / Kotlin。異なるスタックでも全工程を完遂できるかの検証を兼ねた個人プロジェクト

## 技術スタック

**言語・ランタイム**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)

**バックエンド**

![Express](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-2C7A7B?style=for-the-badge)

**データ**

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-FDB515?style=for-the-badge&logo=timescale&logoColor=black)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)

**フロントエンド（監視UI）**

![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

**品質・テスト**

![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=for-the-badge&logo=prettier&logoColor=black)

**運用・開発プロセス**

![PM2](https://img.shields.io/badge/PM2-2B037A?style=for-the-badge&logo=pm2&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=claude&logoColor=white)
![CodeRabbit](https://img.shields.io/badge/CodeRabbit-FF570A?style=for-the-badge)

## 開発スタイル — AI-DLC

AWS が提唱する **AI-DLC（AI-Driven Development Lifecycle）** を個人開発に適用し、「AIが開発プロセスを主導し、人間が監督する」体制で回しています。

```mermaid
flowchart LR
    Human["🧠 人間（私）<br/>やりたいことの言語化<br/>要求の確定・設計判断・監視"] -->|要求・設計| CC["🤖 Claude Code<br/>計画立案・タスク分解<br/>実装・コードレビュー"]
    CC -->|Pull Request| CR["🐰 CodeRabbit<br/>PRレビュー"]
    CR --> Prod["🚀 本番稼働<br/>PM2で24時間常駐"]
    Prod -->|監視| Human
    Prod -->|バグ検知| KB["📚 ナレッジ<br/>レビューチェックリスト<br/>設計ドキュメント"]
    KB -->|次回からAIの<br/>レビュー観点に還元| CC
```

- INCEPTION（要求分析）→ CONSTRUCTION（設計・実装・テスト）→ OPERATIONS のサイクルで進行し、進行状態も文書で管理
- 本番でバグが出たら原因と教訓をナレッジに還元し、次からAIのレビュー観点として効かせる
- AIに任せるには判断基準の言語化が必要。その結果、設計ドキュメント53ファイル・値オブジェクト設計書1,897行が資産として残った

## 中身をちょっとだけ（エンジニア向け）

設計の軸は **DDD（ドメイン駆動設計）× クリーンアーキテクチャ**。ドメインロジックを値オブジェクト中心にモデリングして中核に置き、外部API・DB・UIへの依存は外側のレイヤーに隔離。その境界は人の注意力ではなく、ESLintと構造に守らせています。

- **ポート&アダプタ構成**: domain 層から外側への import はゼロ。ESLint で機械的に強制（[packages/backend/src/](packages/backend/src/)）
- **共有カーネル**: バックテストと本番が同一の domain コードを実行し、「検証したものと動くものが違う」を構造で排除（[packages/backtest/README.md](packages/backtest/README.md)）
- **フェイルセーフ**: サーキットブレーカー、決済失敗の補償キュー、停止時は DB とブローカーの建玉照合（[bin/luchida.sh](bin/luchida.sh)）
- **テスト**: vitest でテストファイル132件。シェルスクリプトにも bats + shellcheck
- **設計ドキュメント**: draw.io 図25点・シーケンス図11本（[docs/design/](docs/design/)）。採用した設計だけでなく「捨てた案と理由」も記録

## 読み方ガイド

- **採用ご担当の方**: ここまでで全体像は伝わっています
- **エンジニアの方**: [project-structure.md](docs/design/overview/project-structure.md) → [value-objects.md](docs/design/value-objects.md) → [packages/backend/src/domain/](packages/backend/src/domain/) の順がおすすめです

## 位置づけ（参画先への申告事項）

- 業務時間外の個人活動です。個人資金のみで検証し、第三者の資金・資産は扱いません
- 所属先・参画先の情報・コードは一切含みません
- 金融商品取引業の登録を要する行為（投資助言・売買システムの販売・シグナル配信等）は行っていません

## このリポジトリについて

非公開リポジトリのスナップショットミラーです（履歴1コミット・Issues / PR なし。開発履歴と意思決定の記録は非公開側で管理）。同期時は公開可能なパスのみをアローリスト方式で抽出し、禁止パターン走査を通しています。

技術ポートフォリオとしての**閲覧のみ**を目的とした公開であり、複製・改変・再配布・実行は許諾していません（[LICENSE](LICENSE)）。

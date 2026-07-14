-- ============================================================
-- bt_runs の標準指標「0」の意味論を判別可能にする（#336）
-- 実行: psql -h <host> -d tick_data -f 004_add_zero_semantics_guards.sql
--
-- 背景: #329 で追加した sortino_standard / sqn_capped の「0」は、
--   (1) 損失0件で割れず番兵値として返した 0（＝下方リスク無し＝最良ケース）
--   (2) 真にブレークイーブン（mean=0, エッジ無し）の 0
--   (3) 既存レコードへ NOT NULL のため入れた未計算の 0
-- の3つが混在し、横断ランキング・スクリーニングで取り違える。
-- 値そのもの（数式）は金融的に正しい。判別のための列を2つ足す。
--
-- has_downside_risk:         (1) と (2)(3) を判別する。false かつ
--                            sortino_standard=0 なら「下方リスク無しの番兵値」。
-- standard_metrics_computed: (3) を判別する。既存レコードは false（未計算）。
--                            true になるまで標準指標を旧 run 横断評価に使わない。
--
-- 既存レコードは未計算（false）として扱う。再計算スクリプトは未実装のため、
-- 実値が必要になった時点で作成し、埋め直したうえで
-- standard_metrics_computed を true に更新すること。
--
-- カバー外: SQN の分母退化（全トレード同一損益で pnl_stddev=0 → sqn_capped=0）
-- は本判別子ではカバーしない。必要になれば別の判別子を検討する。
-- ============================================================

ALTER TABLE backtest.bt_runs
  ADD COLUMN has_downside_risk         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN standard_metrics_computed BOOLEAN NOT NULL DEFAULT FALSE,
  -- CHECK: 「未計算なのに下方リスク有無が分かっている」状態を排除
  ADD CONSTRAINT chk_zero_semantics CHECK (
    standard_metrics_computed OR NOT has_downside_risk
  );

COMMENT ON COLUMN backtest.bt_runs.has_downside_risk IS
  '下方リスク（MAR=0 を下回る損失トレード）が存在したか。standard_metrics_computed=true かつ trade_count > 0 かつ has_downside_risk=false かつ sortino_standard=0 のときのみ「割れない番兵値＝下方リスク無し＝最良ケース」と解釈する。trade_count=0（下方リスクの母数が無い）や standard_metrics_computed=false（未計算の既存レコード）ではこの解釈は無効。0 を不良成績と読まない判別子';
COMMENT ON COLUMN backtest.bt_runs.standard_metrics_computed IS
  '標準指標（sortino_standard / annualized_sortino_standard / sqn_capped）を計算済みか。false（既存レコード）は未計算で、その 0 は無意味。true になるまで旧 run 横断の比較・ソート・平均に標準指標を使わない';

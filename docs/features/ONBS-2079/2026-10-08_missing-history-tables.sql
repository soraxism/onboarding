-- ONBS-2079: ガイド履歴テーブルが存在しないプロダクトの洗い出し
--
-- 実行前に対象DBを選択すること（DATABASE() を参照しているため）。
--   USE onboarding_db;
--
-- 参照のみ。更新は行わない。
--
-- 履歴テーブルは全プロダクトに存在するのが本来の状態で、無いプロダクトはすべて
-- バックフィルの対象になる。フィーチャーフラグの有効・無効では絞らない。

-- ---------------------------------------------------------------------------
-- 1. フロート履歴テーブルが無いプロダクト（本題）
-- ---------------------------------------------------------------------------
SELECT
    p.account_id,
    p.id   AS product_id,
    p.name AS product_name,
    p.code AS product_code,
    p.created_at
FROM products p
LEFT JOIN information_schema.TABLES t
       ON t.TABLE_SCHEMA = DATABASE()
      AND t.TABLE_NAME   = CONCAT('onb_float_histories_', p.code)
WHERE p.is_deleted = 0
  AND t.TABLE_NAME IS NULL
ORDER BY p.id;


-- ---------------------------------------------------------------------------
-- 2. 件数（影響規模の把握）
-- ---------------------------------------------------------------------------
SELECT
    COUNT(*) AS products_without_onb_float_histories
FROM products p
LEFT JOIN information_schema.TABLES t
       ON t.TABLE_SCHEMA = DATABASE()
      AND t.TABLE_NAME   = CONCAT('onb_float_histories_', p.code)
WHERE p.is_deleted = 0
  AND t.TABLE_NAME IS NULL;


-- ---------------------------------------------------------------------------
-- 3. ガイド種別ごとの欠落状況（ツアー・ヒントにも漏れが無いかの確認）
-- ---------------------------------------------------------------------------
SELECT
    p.account_id,
    p.id   AS product_id,
    p.code AS product_code,
    CASE WHEN tt.TABLE_NAME IS NULL THEN 'MISSING' ELSE 'ok' END AS tour_histories,
    CASE WHEN th.TABLE_NAME IS NULL THEN 'MISSING' ELSE 'ok' END AS hint_histories,
    CASE WHEN tf.TABLE_NAME IS NULL THEN 'MISSING' ELSE 'ok' END AS onb_float_histories
FROM products p
LEFT JOIN information_schema.TABLES tt
       ON tt.TABLE_SCHEMA = DATABASE() AND tt.TABLE_NAME = CONCAT('tour_histories_', p.code)
LEFT JOIN information_schema.TABLES th
       ON th.TABLE_SCHEMA = DATABASE() AND th.TABLE_NAME = CONCAT('hint_histories_', p.code)
LEFT JOIN information_schema.TABLES tf
       ON tf.TABLE_SCHEMA = DATABASE() AND tf.TABLE_NAME = CONCAT('onb_float_histories_', p.code)
WHERE p.is_deleted = 0
  AND (tt.TABLE_NAME IS NULL OR th.TABLE_NAME IS NULL OR tf.TABLE_NAME IS NULL)
ORDER BY p.id;


-- ---------------------------------------------------------------------------
-- 4. バックフィル用の CREATE TABLE 文を生成する
--
-- 実行結果をそのまま流すのではなく、1 の結果と突き合わせて対象を確認してから使うこと。
-- カラム定義は管理APIの api/rest/layers/python/lib/onb_float_groups.py の
-- create_history と同一にしてある。ずれると発行経路によって挙動が変わる。
-- ---------------------------------------------------------------------------
SELECT CONCAT(
    'CREATE TABLE `onb_float_histories_', p.code, '` (',
    '`id` int(10) unsigned NOT NULL AUTO_INCREMENT, ',
    '`onb_float_group_id` int(10) DEFAULT NULL, ',
    '`onb_float_json_src` longtext, ',
    '`created_at` datetime DEFAULT NULL, ',
    '`created_by` int(10) unsigned DEFAULT NULL, ',
    'PRIMARY KEY (`id`), ',
    'INDEX `onb_float_group_id` (`onb_float_group_id`)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;'
) AS ddl
FROM products p
LEFT JOIN information_schema.TABLES t
       ON t.TABLE_SCHEMA = DATABASE()
      AND t.TABLE_NAME   = CONCAT('onb_float_histories_', p.code)
WHERE p.is_deleted = 0
  AND t.TABLE_NAME IS NULL
ORDER BY p.id;

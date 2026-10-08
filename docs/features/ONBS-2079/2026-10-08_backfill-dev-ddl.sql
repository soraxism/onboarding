-- ONBS-2079: フロート履歴テーブルのバックフィル（dev環境）
--
-- 2026-10-08 時点の洗い出し結果（10件）に対する CREATE TABLE 文。
-- 実行前に対象DBを選択すること。
--   USE onboarding_db;
--
-- 注意
--   * 実行前に 2026-10-08_missing-history-tables.sql の 1 を流し直し、
--     対象が変わっていないか確認すること
--   * カラム定義は管理APIの api/rest/layers/python/lib/onb_float_groups.py の
--     create_history と同一。ずれると発行経路によって挙動が変わる
--   * 初期データの投入は不要。配信API の _to_group が created_at IS NULL を
--     空文字へフォールバックするため、履歴 0 件でも 500 にはならない
--   * product_code にハイフンを含むため、テーブル名はバッククォートで囲む必要がある

-- account_id=1 / product_id=255 / 宇野テスト
CREATE TABLE `onb_float_histories_uno-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=256 / 吉田テスト
CREATE TABLE `onb_float_histories_yoshida-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=257 / 杵渕テスト
CREATE TABLE `onb_float_histories_kinefuchi-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=258 / 山崎テスト
CREATE TABLE `onb_float_histories_yamazaki-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=259 / 織田テスト
CREATE TABLE `onb_float_histories_oda-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=260 / 椎名テスト
CREATE TABLE `onb_float_histories_shiina-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=261 / 藤原テスト
CREATE TABLE `onb_float_histories_fujiwara-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=262 / 武藤テスト
CREATE TABLE `onb_float_histories_muto-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=1 / product_id=263 / 露木テスト
CREATE TABLE `onb_float_histories_tsuyuki-test` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- account_id=147 / product_id=264 / フロートテーブル追加確認
CREATE TABLE `onb_float_histories_float-history-table-added` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `onb_float_group_id` int(10) DEFAULT NULL,
    `onb_float_json_src` longtext,
    `created_at` datetime DEFAULT NULL,
    `created_by` int(10) unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

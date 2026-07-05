-- ============================================================
--  TYPING BATTLE — HeidiSQL Setup Script (LENGKAP)
--  Cara pakai:
--    1. Buka HeidiSQL → connect ke localhost (root, no password)
--    2. Klik menu "File" → "Run SQL file..." → pilih file ini
--    ATAU paste semua isi file ini ke tab "Query" lalu tekan F9
-- ============================================================

-- ── 1. Buat Database ─────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS `typing_battle`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `typing_battle`;

-- ── 2. Drop tabel lama (kalau mau reset bersih) ──────────────
-- Hapus tanda komentar (--) di bawah ini jika ingin reset total:
-- DROP TABLE IF EXISTS `match_players`;
-- DROP TABLE IF EXISTS `matches`;
-- DROP TABLE IF EXISTS `players`;

-- ── 3. Tabel pemain (players) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS `players` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(50)     NOT NULL,
  `best_wpm`      INT             NOT NULL DEFAULT 0,
  `total_matches` INT             NOT NULL DEFAULT 0,
  `total_wins`    INT             NOT NULL DEFAULT 0,
  `last_played`   TIMESTAMP       NULL DEFAULT NULL,
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Tabel pertandingan (matches) ──────────────────────────
CREATE TABLE IF NOT EXISTS `matches` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `winner`     VARCHAR(50)  NULL DEFAULT NULL,
  `end_time`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Tabel detail pemain per pertandingan (match_players) ───
CREATE TABLE IF NOT EXISTS `match_players` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `match_id`   INT UNSIGNED NOT NULL,
  `username`   VARCHAR(50)  NOT NULL,
  `wpm`        INT          NOT NULL DEFAULT 0,
  `accuracy`   INT          NOT NULL DEFAULT 100,
  `rank`       INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `fk_match` (`match_id`),
  CONSTRAINT `fk_match_players_match`
    FOREIGN KEY (`match_id`) REFERENCES `matches` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. Verifikasi tabel berhasil dibuat ──────────────────────
SELECT 
  TABLE_NAME        AS `Tabel`,
  TABLE_ROWS        AS `Estimasi Baris`,
  CREATE_TIME       AS `Waktu Dibuat`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'typing_battle'
ORDER BY TABLE_NAME;

-- ── 7. Konfirmasi selesai ─────────────────────────────────────
SELECT 'Database typing_battle berhasil dibuat! Sekarang jalankan start-server.bat' AS `STATUS`;

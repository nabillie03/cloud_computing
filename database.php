<?php
// ─── KONFIGURASI DATABASE (Laragon / HeidiSQL) ───────────────────────────────
// Default Laragon: host=localhost, user=root, password=kosong
// Ubah jika konfigurasi Laragon kamu berbeda.

define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_USER', 'root');
define('DB_PASS', '');           // Laragon default: kosong
define('DB_NAME', 'typing_battle');
define('DB_CHARSET', 'utf8mb4');

/**
 * Membuat dan mengembalikan koneksi MySQLi.
 * Panggil fungsi ini di setiap file PHP yang butuh akses database.
 *
 * @return mysqli
 */
function createDB(): mysqli
{
    $db = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
    if (!$db->connect_error) {
        $db->set_charset(DB_CHARSET);
    }
    return $db;
}

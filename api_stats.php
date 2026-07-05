<?php
/**
 * server/api_stats.php
 * REST API untuk statistik & pencarian pemain Typing Battle.
 * Dipanggil oleh dashboard.php via AJAX.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
error_reporting(0);
ini_set('display_errors', 0);

require_once __DIR__ . '/../config/database.php';

$db = createDB();
if ($db->connect_error) {
    echo json_encode(['error' => 'Koneksi database gagal: ' . $db->connect_error]);
    exit;
}

// ── Cari satu pemain (GET ?username=...) ──────────────────────────────────────
$username = isset($_GET['username']) ? trim($_GET['username']) : null;

if ($username) {
    $stmt = $db->prepare(
        "SELECT p.username,
                COALESCE(p.best_wpm, 0)      AS best_wpm,
                COALESCE(p.total_matches, 0) AS total_matches,
                COALESCE(p.total_wins, 0)    AS total_wins,
                p.last_played,
                COALESCE(SUM(mp.backspace_count), 0) AS total_backspace
         FROM players p
         LEFT JOIN match_players mp ON mp.username = p.username
         WHERE p.username = ?
         GROUP BY p.username
         LIMIT 1"
    );
    if (!$stmt) {
        echo json_encode(['error' => 'Query gagal: ' . $db->error]);
        exit;
    }
    $stmt->bind_param('s', $username);
    $stmt->execute();
    $player = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $db->close();
    echo json_encode(['player' => $player ?: null]);
    exit;
}

// ── Data dashboard lengkap ─────────────────────────────────────────────────────
$response = [];

// 1. Global Leaderboard — Best WPM
$res = $db->query(
    "SELECT username,
            COALESCE(best_wpm, 0)      AS best_wpm,
            COALESCE(total_matches, 0) AS total_matches,
            COALESCE(total_wins, 0)    AS total_wins
     FROM players
     WHERE best_wpm > 0
     ORDER BY best_wpm DESC
     LIMIT 10"
);
$response['leaderboard'] = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

// 2. Most Wins
$res = $db->query(
    "SELECT username,
            COALESCE(total_wins, 0)    AS total_wins,
            COALESCE(total_matches, 0) AS total_matches
     FROM players
     WHERE total_wins > 0
     ORDER BY total_wins DESC
     LIMIT 10"
);
$response['mostWins'] = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

// 3. Recent Matches (dari tabel matches + match_players)
$chkMatches       = $db->query("SHOW TABLES LIKE 'matches'");
$chkMatchPlayers  = $db->query("SHOW TABLES LIKE 'match_players'");

if ($chkMatches && $chkMatches->num_rows > 0
    && $chkMatchPlayers && $chkMatchPlayers->num_rows > 0) {
    $res = $db->query("
        SELECT m.id,
               m.end_time,
               m.winner,
               (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 2 LIMIT 1) AS runner_up,
               (SELECT MAX(wpm) FROM match_players WHERE match_id = m.id) AS top_wpm,
               (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 1 LIMIT 1) AS bs_rank1,
               (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 2 LIMIT 1) AS bs_rank2,
               (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 3 LIMIT 1) AS bs_rank3,
               (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 3 LIMIT 1) AS rank3_name,
               (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 4 LIMIT 1) AS bs_rank4,
               (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 4 LIMIT 1) AS rank4_name,
               (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 5 LIMIT 1) AS bs_rank5,
               (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 5 LIMIT 1) AS rank5_name
        FROM matches m
        ORDER BY m.end_time DESC
        LIMIT 10
    ");
    $response['recentMatches'] = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];
} else {
    $response['recentMatches'] = [];
}

// 4. Summary stats
$res = $db->query("SELECT COUNT(*) AS total, COALESCE(MAX(best_wpm), 0) AS top FROM players");
if ($res) {
    $row = $res->fetch_assoc();
    $response['totalPlayers'] = (int) $row['total'];
    $response['topWpm']       = (int) $row['top'];
} else {
    $response['totalPlayers'] = 0;
    $response['topWpm']       = 0;
}

$db->close();
echo json_encode($response);
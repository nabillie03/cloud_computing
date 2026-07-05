<?php
/**
 * dashboard.php — Halaman statistik arena Typing Battle.
 * Data leaderboard & match diambil langsung dari database (server-side).
 * Fitur pencarian pemain tetap menggunakan AJAX → api_stats.php
 */

require_once __DIR__ . '/../config/database.php';

$db = createDB();
$dbError = $db->connect_error;

$leaderboard   = [];
$mostWins      = [];
$recentMatches = [];
$totalPlayers  = 0;
$topWpm        = 0;

if (!$dbError) {
    // ── Auto-migrate: tambah kolom jika belum ada (kompatibel semua MySQL) ─
    $existingCols = [];
    $colRes = $db->query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                          WHERE TABLE_SCHEMA = '" . DB_NAME . "' AND TABLE_NAME = 'players'");
    if ($colRes) while ($r = $colRes->fetch_assoc()) $existingCols[] = $r['COLUMN_NAME'];

    if (!in_array('total_matches', $existingCols))
        $db->query("ALTER TABLE players ADD COLUMN total_matches INT DEFAULT 0");
    if (!in_array('total_wins', $existingCols))
        $db->query("ALTER TABLE players ADD COLUMN total_wins INT DEFAULT 0");
    if (!in_array('last_played', $existingCols))
        $db->query("ALTER TABLE players ADD COLUMN last_played TIMESTAMP NULL DEFAULT NULL");

    // Auto-migrate: tambah kolom backspace_count di match_players jika belum ada
    $mpCols = [];
    $mpRes  = $db->query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                          WHERE TABLE_SCHEMA = '" . DB_NAME . "' AND TABLE_NAME = 'match_players'");
    if ($mpRes) while ($r = $mpRes->fetch_assoc()) $mpCols[] = $r['COLUMN_NAME'];
    if (!in_array('backspace_count', $mpCols))
        $db->query("ALTER TABLE match_players ADD COLUMN backspace_count INT DEFAULT 0");

    // ── Leaderboard — Best WPM ─────────────────────────────────────────────
    $res = $db->query(
        "SELECT username,
                COALESCE(best_wpm, 0)      AS best_wpm,
                COALESCE(total_matches, 0) AS total_matches,
                COALESCE(total_wins, 0)    AS total_wins
         FROM players
         WHERE best_wpm IS NOT NULL AND best_wpm > 0
         ORDER BY best_wpm DESC LIMIT 10"
    );
    if ($res) $leaderboard = $res->fetch_all(MYSQLI_ASSOC);

    // ── Most Wins ──────────────────────────────────────────────────────────
    $res = $db->query(
        "SELECT username,
                COALESCE(total_wins, 0)    AS total_wins,
                COALESCE(total_matches, 0) AS total_matches
         FROM players WHERE total_wins > 0
         ORDER BY total_wins DESC LIMIT 10"
    );
    if ($res) $mostWins = $res->fetch_all(MYSQLI_ASSOC);

    // ── Recent Matches ─────────────────────────────────────────────────────
    $tableCheck  = $db->query("SHOW TABLES LIKE 'matches'");
    $tableCheck2 = $db->query("SHOW TABLES LIKE 'match_players'");
    if ($tableCheck && $tableCheck->num_rows > 0 && $tableCheck2 && $tableCheck2->num_rows > 0) {
        $res = $db->query("
            SELECT m.id, m.end_time, m.winner,
                   (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 2 LIMIT 1) AS runner_up,
                   (SELECT MAX(wpm) FROM match_players WHERE match_id = m.id) AS top_wpm,
                   (SELECT wpm FROM match_players WHERE match_id = m.id AND `rank` = 1 LIMIT 1) AS wpm_rank1,
                   (SELECT wpm FROM match_players WHERE match_id = m.id AND `rank` = 2 LIMIT 1) AS wpm_rank2,
                   (SELECT wpm FROM match_players WHERE match_id = m.id AND `rank` = 3 LIMIT 1) AS wpm_rank3,
                   (SELECT wpm FROM match_players WHERE match_id = m.id AND `rank` = 4 LIMIT 1) AS wpm_rank4,
                   (SELECT wpm FROM match_players WHERE match_id = m.id AND `rank` = 5 LIMIT 1) AS wpm_rank5,
                   (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 1 LIMIT 1) AS bs_rank1,
                   (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 2 LIMIT 1) AS bs_rank2,
                   (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 3 LIMIT 1) AS bs_rank3,
                   (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 3 LIMIT 1) AS rank3_name,
                   (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 4 LIMIT 1) AS rank4_name,
                   (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 4 LIMIT 1) AS bs_rank4,
                   (SELECT username FROM match_players WHERE match_id = m.id AND `rank` = 5 LIMIT 1) AS rank5_name,
                   (SELECT backspace_count FROM match_players WHERE match_id = m.id AND `rank` = 5 LIMIT 1) AS bs_rank5
            FROM matches m ORDER BY m.end_time DESC LIMIT 10
        ");
        if ($res) $recentMatches = $res->fetch_all(MYSQLI_ASSOC);
    }

    // ── Summary Stats ──────────────────────────────────────────────────────
    $res = $db->query("SELECT COUNT(*) AS total, COALESCE(MAX(best_wpm),0) AS top FROM players");
    if ($res) {
        $row         = $res->fetch_assoc();
        $totalPlayers = (int) $row['total'];
        $topWpm       = (int) $row['top'];
    }

    $db->close();
}

// ── Helper: escape output ──────────────────────────────────────────────────
function e(string $str): string {
    return htmlspecialchars($str, ENT_QUOTES, 'UTF-8');
}

// ── Helper: render rank badge ──────────────────────────────────────────────
function rankBadge(int $i): string {
    return match($i) {
        0 => '🥇', 1 => '🥈', 2 => '🥉', default => '#' . ($i + 1)
    };
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Typing Battle — Cyber Stats Arena</title>
    <meta name="description" content="Dashboard statistik dan leaderboard pemain Typing Battle.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&family=Nunito:wght@400;600;800&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
            --bg:          #0d0d14;
            --surface:     rgba(255,255,255,0.03);
            --border:      rgba(255,255,255,0.07);
            --orange:      #FF6B35;
            --cyan:        #06D6FE;
            --green:       #00FF88;
            --pink:        #FF2D7A;
            --yellow:      #FFE600;
            --text:        #F0F0F8;
            --muted:       #8b949e;
            --radius:      20px;
        }

        body {
            background: var(--bg);
            font-family: 'Nunito', sans-serif;
            color: var(--text);
            min-height: 100vh;
            padding-top: 72px;
        }

        /* ── Nebula background ──────────────────────────────────────── */
        .nebula-bg {
            position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
        }
        .nebula {
            position: absolute; border-radius: 50%;
            filter: blur(100px); opacity: 0.12;
        }
        .n-orange { width: 500px; height: 500px; background: var(--orange); top: -100px; right: -100px; }
        .n-cyan   { width: 400px; height: 400px; background: var(--cyan);   bottom: 0;   left: -80px;  }
        .n-pink   { width: 300px; height: 300px; background: var(--pink);   top: 40%;    left: 40%;    }

        /* ── Navbar ─────────────────────────────────────────────────── */
        .navbar {
            position: fixed; top: 0; left: 0; right: 0; z-index: 100;
            height: 64px;
            background: rgba(13,13,20,0.85);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid var(--border);
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 28px;
        }
        .logo {
            font-family: 'Fredoka', sans-serif;
            font-size: 1.5rem; font-weight: 700;
            display: flex; align-items: center; gap: 8px;
        }
        .logo span { color: var(--orange); }
        .nav-links { display: flex; gap: 8px; }
        .nav-link {
            color: var(--muted);
            text-decoration: none;
            padding: 8px 16px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        .nav-link:hover { color: var(--cyan); background: rgba(6,214,254,0.08); }
        .nav-link.active { color: var(--cyan); background: rgba(6,214,254,0.1); }

        /* ── Layout ─────────────────────────────────────────────────── */
        .container { max-width: 1300px; margin: 0 auto; padding: 36px 24px 60px; position: relative; z-index: 1; }

        .page-header { margin-bottom: 36px; }
        .page-header h1 {
            font-size: 2.2rem; font-weight: 800;
            background: linear-gradient(135deg, var(--orange), var(--cyan));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
        }
        .page-header p { color: var(--muted); font-size: 1rem; }

        /* ── Summary cards ──────────────────────────────────────────── */
        .summary-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px; margin-bottom: 36px;
        }
        .summary-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 20px 24px;
            backdrop-filter: blur(12px);
        }
        .summary-card .label { color: var(--muted); font-size: 0.8rem; letter-spacing: 1px; margin-bottom: 6px; }
        .summary-card .value { font-size: 2rem; font-weight: 800; }

        /* ── Stats grid ─────────────────────────────────────────────── */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
            gap: 24px; margin-bottom: 36px;
        }
        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 24px;
            backdrop-filter: blur(16px);
        }
        .card-title {
            font-size: 1rem; font-weight: 700; letter-spacing: 1px;
            color: var(--cyan);
            border-left: 3px solid var(--orange);
            padding-left: 12px;
            margin-bottom: 20px;
        }

        /* ── Table ──────────────────────────────────────────────────── */
        table { width: 100%; border-collapse: collapse; }
        th, td {
            padding: 11px 10px;
            text-align: left;
            border-bottom: 1px solid var(--border);
            font-size: 0.9rem;
        }
        th { color: var(--muted); font-size: 0.75rem; letter-spacing: 1px; font-weight: 700; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(255,255,255,0.02); }
        .rank-badge { font-size: 1.1rem; }
        .winner { color: var(--yellow); font-weight: 700; }
        .highlight { color: var(--cyan); font-weight: 700; }
        .wpm-value { color: var(--green); font-family: 'Fira Code', monospace; font-weight: 600; }
        .empty-row { text-align: center; padding: 32px; color: var(--muted); font-style: italic; }

        /* ── Search section ─────────────────────────────────────────── */
        .search-card { margin-bottom: 0; }
        .search-bar {
            display: flex; gap: 12px; margin-bottom: 20px;
        }
        .search-bar input {
            flex: 1; padding: 12px 18px;
            background: rgba(255,255,255,0.05);
            border: 1px solid var(--border);
            border-radius: 12px;
            color: var(--text);
            font-family: 'Fira Code', monospace;
            font-size: 0.95rem;
            outline: none;
            transition: border 0.2s;
        }
        .search-bar input:focus { border-color: var(--cyan); }
        .search-bar button {
            padding: 0 28px;
            background: linear-gradient(135deg, var(--orange), #FFB830);
            border: none; border-radius: 12px;
            font-family: 'Nunito', sans-serif;
            font-weight: 800; font-size: 0.95rem;
            cursor: pointer; color: #fff;
            transition: opacity 0.2s, transform 0.15s;
        }
        .search-bar button:hover { opacity: 0.88; transform: translateY(-1px); }

        /* ── Player stats result ────────────────────────────────────── */
        .player-result {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 14px; margin-top: 4px;
        }
        .stat-pill {
            background: rgba(255,255,255,0.04);
            border: 1px solid var(--border);
            border-radius: 14px;
            padding: 16px;
        }
        .stat-pill .pl { color: var(--muted); font-size: 0.78rem; margin-bottom: 6px; }
        .stat-pill .pv { font-size: 1.5rem; font-weight: 800; }
        .msg { text-align: center; padding: 24px; color: var(--muted); }
        .error-msg { text-align: center; padding: 24px; color: var(--pink); }

        /* ── DB error banner ────────────────────────────────────────── */
        .db-error {
            background: rgba(255,45,122,0.1);
            border: 1px solid rgba(255,45,122,0.3);
            border-radius: 14px; padding: 20px 24px;
            margin-bottom: 28px; color: var(--pink);
            font-weight: 600;
        }

        /* ── Responsive ─────────────────────────────────────────────── */
        @media (max-width: 600px) {
            .stats-grid { grid-template-columns: 1fr; }
            .summary-row { grid-template-columns: repeat(2, 1fr); }
            .page-header h1 { font-size: 1.6rem; }
        }
    </style>
</head>
<body>

<!-- Nebula -->
<div class="nebula-bg" aria-hidden="true">
    <div class="nebula n-orange"></div>
    <div class="nebula n-cyan"></div>
    <div class="nebula n-pink"></div>
</div>

<!-- Navbar -->
<nav class="navbar" aria-label="Main navigation">
    <div class="logo">⌨️ Typing<span>Battle</span></div>
    <div class="nav-links">
        <a href="../index.php" class="nav-link">🎮 Kembali ke Arena</a>
        <a href="dashboard.php" class="nav-link active">📊 Dashboard</a>
    </div>
</nav>

<div class="container">

    <!-- Page header -->
    <div class="page-header">
        <h1>📊 Cyber Stats Arena</h1>
        <p>Statistik pertarungan mengetik secara real-time dari database</p>
    </div>

    <?php if ($dbError): ?>
    <!-- DB Error Banner -->
    <div class="db-error">
        ❌ Tidak dapat terhubung ke database: <strong><?= e($dbError) ?></strong><br>
        <small>Pastikan MySQL berjalan dan pengaturan di <code>config/database.php</code> sudah benar.</small>
    </div>
    <?php endif; ?>

    <!-- Summary cards -->
    <div class="summary-row">
        <div class="summary-card">
            <div class="label">👤 TOTAL PEMAIN</div>
            <div class="value" style="color:var(--cyan)"><?= $totalPlayers ?></div>
        </div>
        <div class="summary-card">
            <div class="label">⚡ REKOR WPM</div>
            <div class="value" style="color:var(--green)"><?= $topWpm ?></div>
        </div>
        <div class="summary-card">
            <div class="label">🏆 TOP PLAYER</div>
            <div class="value" style="color:var(--orange); font-size:1.3rem;">
                <?= isset($leaderboard[0]) ? e($leaderboard[0]['username']) : '—' ?>
            </div>
        </div>
        <div class="summary-card">
            <div class="label">🔥 TOTAL MATCH</div>
            <div class="value" style="color:var(--pink)">
                <?= $recentMatches ? count($recentMatches) . '+' : '—' ?>
            </div>
        </div>
    </div>

    <!-- Stats grid: leaderboard + most wins + recent matches -->
    <div class="stats-grid">

        <!-- Leaderboard -->
        <div class="card">
            <div class="card-title">🏆 Global Leaderboard (Best WPM)</div>
            <?php if (empty($leaderboard)): ?>
                <p class="empty-row">Belum ada data pemain.</p>
            <?php else: ?>
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Username</th>
                        <th>Best WPM</th>
                        <th>Match</th>
                        <th>Win Rate</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($leaderboard as $i => $p):
                        $wr = $p['total_matches'] > 0
                            ? number_format(($p['total_wins'] / $p['total_matches']) * 100, 1)
                            : '0.0';
                    ?>
                    <tr>
                        <td class="rank-badge"><?= rankBadge($i) ?></td>
                        <td class="highlight"><?= e($p['username']) ?></td>
                        <td class="wpm-value"><?= (int)$p['best_wpm'] ?></td>
                        <td><?= (int)$p['total_matches'] ?></td>
                        <td><?= $wr ?>%</td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
        </div>

        <!-- Most Wins -->
        <div class="card">
            <div class="card-title">⚔️ Most Wins</div>
            <?php if (empty($mostWins)): ?>
                <p class="empty-row">Belum ada data kemenangan.</p>
            <?php else: ?>
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Username</th>
                        <th>Total Menang</th>
                        <th>Total Match</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($mostWins as $i => $p): ?>
                    <tr>
                        <td class="rank-badge"><?= rankBadge($i) ?></td>
                        <td><?= e($p['username']) ?></td>
                        <td class="winner"><?= (int)$p['total_wins'] ?></td>
                        <td><?= (int)$p['total_matches'] ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
        </div>

        <!-- Recent Matches -->
        <div class="card">
            <div class="card-title">🔥 Recent Matches</div>
            <?php if (empty($recentMatches)): ?>
                <p class="empty-row">Belum ada pertandingan tercatat.</p>
            <?php else: ?>
            <table>
                <thead>
                    <tr>
                        <th>Waktu</th>
                        <th>Pemain</th>
                        <th>WPM</th>
                        <th>⌫ Backspace</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($recentMatches as $m): ?>
                    <?php
                        // Kumpulkan semua pemain di match ini dengan rank-nya
                        $matchPlayers = [];
                        if (!empty($m['winner']))     $matchPlayers[] = ['rank'=>1,'name'=>$m['winner'],      'wpm'=>(int)($m['wpm_rank1']??0),'bs'=>(int)($m['bs_rank1']??0),'medal'=>'🥇'];
                        if (!empty($m['runner_up']))  $matchPlayers[] = ['rank'=>2,'name'=>$m['runner_up'],   'wpm'=>(int)($m['wpm_rank2']??0),'bs'=>(int)($m['bs_rank2']??0),'medal'=>'🥈'];
                        if (!empty($m['rank3_name'])) $matchPlayers[] = ['rank'=>3,'name'=>$m['rank3_name'],  'wpm'=>(int)($m['wpm_rank3']??0),'bs'=>(int)($m['bs_rank3']??0),'medal'=>'🥉'];
                        if (!empty($m['rank4_name'])) $matchPlayers[] = ['rank'=>4,'name'=>$m['rank4_name'],  'wpm'=>(int)($m['wpm_rank4']??0),'bs'=>(int)($m['bs_rank4']??0),'medal'=>'4️⃣'];
                        if (!empty($m['rank5_name'])) $matchPlayers[] = ['rank'=>5,'name'=>$m['rank5_name'],  'wpm'=>(int)($m['wpm_rank5']??0),'bs'=>(int)($m['bs_rank5']??0),'medal'=>'5️⃣'];
                        $rowCount = count($matchPlayers);
                    ?>
                    <?php foreach ($matchPlayers as $idx => $pl): ?>
                    <tr>
                        <?php if ($idx === 0): ?>
                        <td rowspan="<?= $rowCount ?>" style="font-size:0.8rem;color:var(--muted);vertical-align:middle;border-right:1px solid rgba(255,255,255,0.06);">
                            <?= date('d/m', strtotime($m['end_time'])) ?><br>
                            <span style="color:var(--muted);opacity:0.7"><?= date('H:i', strtotime($m['end_time'])) ?></span>
                        </td>
                        <?php endif; ?>
                        <td>
                            <span style="margin-right:4px"><?= $pl['medal'] ?></span>
                            <?= e($pl['name']) ?>
                        </td>
                        <td class="wpm-value" style="font-size:0.9rem">
                            <?= $pl['wpm'] > 0 ? $pl['wpm'] : '<span style="color:var(--muted)">0</span>' ?>
                        </td>
                        <td style="color:var(--pink);font-weight:700;font-size:0.95rem">
                            <?= $pl['bs'] ?>×
                        </td>
                    </tr>
                    <?php endforeach; ?>
                    <tr><td colspan="4" style="height:4px;background:rgba(255,255,255,0.03);padding:0"></td></tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
        </div>

    </div><!-- /stats-grid -->

    <!-- Search player -->
    <div class="card search-card">
        <div class="card-title">🔍 Cari Statistik Pemain</div>
        <div class="search-bar">
            <input type="text" id="search-username" placeholder="Masukkan username pemain..." autocomplete="off">
            <button id="search-btn">Cari</button>
        </div>
        <div id="player-stats"></div>
    </div>

</div><!-- /container -->

<script>
    // ── Pencarian pemain — AJAX ke api_stats.php ──────────────────────────
    const API_URL = 'api_stats.php';

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
    }

    async function searchPlayer() {
        const username = document.getElementById('search-username').value.trim();
        if (!username) return;
        const el = document.getElementById('player-stats');
        el.innerHTML = '<p class="msg">⏳ Mencari...</p>';
        try {
            const res  = await fetch(`${API_URL}?username=${encodeURIComponent(username)}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            displayPlayerStats(data.player);
        } catch (err) {
            el.innerHTML = `<p class="error-msg">❌ ${escapeHtml(err.message)}</p>`;
        }
    }

    function displayPlayerStats(player) {
        const el = document.getElementById('player-stats');
        if (!player) {
            el.innerHTML = '<p class="msg">Pemain tidak ditemukan.</p>';
            return;
        }
        const wr = player.total_matches > 0
            ? ((player.total_wins / player.total_matches) * 100).toFixed(1) : '0.0';
        const lastPlayed = player.last_played
            ? new Date(player.last_played).toLocaleDateString('id-ID') : '—';

        el.innerHTML = `
        <div class="player-result">
            <div class="stat-pill">
                <div class="pl">USERNAME</div>
                <div class="pv" style="color:var(--cyan); font-size:1.1rem;">${escapeHtml(player.username)}</div>
            </div>
            <div class="stat-pill">
                <div class="pl">⚡ BEST WPM</div>
                <div class="pv" style="color:var(--green)">${player.best_wpm || 0}</div>
            </div>
            <div class="stat-pill">
                <div class="pl">🎮 TOTAL MATCH</div>
                <div class="pv">${player.total_matches || 0}</div>
            </div>
            <div class="stat-pill">
                <div class="pl">🏆 TOTAL MENANG</div>
                <div class="pv" style="color:var(--yellow)">${player.total_wins || 0}</div>
            </div>
            <div class="stat-pill">
                <div class="pl">📈 WIN RATE</div>
                <div class="pv" style="color:var(--orange)">${wr}%</div>
            </div>
            <div class="stat-pill">
                <div class="pl">⌫ TOTAL BACKSPACE</div>
                <div class="pv" style="color:var(--pink)">${player.total_backspace || 0}</div>
            </div>
            <div class="stat-pill">
                <div class="pl">🕒 LAST PLAYED</div>
                <div class="pv" style="font-size:1rem; color:var(--muted)">${lastPlayed}</div>
            </div>
        </div>`;
    }

    document.getElementById('search-btn').addEventListener('click', searchPlayer);
    document.getElementById('search-username').addEventListener('keypress', e => {
        if (e.key === 'Enter') searchPlayer();
    });
</script>
</body>
</html>
<?php
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Typing Battle — Cyber Arena</title>
    <meta name="description" content="Game mengetik multiplayer real-time. Compete. Conquer. Type Faster.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@300;400;500;600;700&family=Nunito:wght@300;400;500;600;700;800&family=Fira+Code:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="public/style.css">
</head>
<body>

<!-- ── Nebula Background ──────────────────────────────────── -->
<div class="nebula-bg" aria-hidden="true">
    <div class="nebula nebula-orange"></div>
    <div class="nebula nebula-cyan"></div>
    <div class="nebula nebula-pink"></div>
    <div class="nebula nebula-orange2"></div>
    <div class="grid-overlay"></div>
</div>

<!-- ── Navbar ────────────────────────────────────────────── -->
<nav class="navbar" aria-label="Main navigation">
    <div class="navbar-inner">
        <a href="#" class="nav-logo">
            <span class="nav-logo-icon">⌨️</span>
            <span class="nav-logo-text">Typing<span class="nav-logo-highlight">Battle</span></span>
        </a>
        <div class="nav-right">
            <span class="nav-live-badge">
                <span class="nav-live-dot"></span>
                LIVE
            </span>
            <a href="public/dashboard.php" class="nav-dashboard-btn" id="nav-dashboard-link">📊 Dashboard</a>
        </div>
    </div>
</nav>

<!-- ══════════ LOBBY SCREEN ══════════ -->
<div id="lobby-screen" class="screen">
    <div class="lobby-hero">

        <div class="hero-badge">
            <span class="hero-badge-dot">⚡</span>
            Real-time Multiplayer
        </div>

        <h1 class="game-title">
            <span class="title-line-1">Typing</span>
            <span class="title-line-2">Battle</span>
        </h1>
        <p class="subtitle">Compete. Conquer. Type Faster.</p>

        <div class="input-group">
            <div class="input-wrapper">
                <span class="input-icon">👤</span>
                <input type="text" id="username-input"
                       placeholder="Enter your callsign..."
                       maxlength="20" autocomplete="off">
            </div>
            <div class="cta-buttons">
                <button id="join-multi-btn" class="btn-gradient">
                    <span class="btn-icon">🚀</span>
                    <span>Start Game</span>
                    <span class="btn-glow"></span>
                </button>
                <button id="join-solo-btn" class="btn-glass">
                    <span class="btn-icon">🎯</span>
                    <span>Practice Solo</span>
                </button>
            </div>
        </div>

        <!-- WS Status Bar -->
        <div id="ws-status-bar" class="ws-status-bar">🟡 <span>Menghubungkan ke server...</span></div>

        <!-- Player List -->
        <div id="player-list-container" class="hidden">
            <div class="player-list-header">
                <span class="player-list-title">⚔️ ARENA LOBBY</span>
                <span id="player-count" class="player-count-badge">(0/5)</span>
            </div>
            <ul id="player-list"></ul>
            <p id="status-text" class="waiting-text">
                <span class="waiting-dots">
                    <span></span><span></span><span></span>
                </span>
                Menunggu pemain lain...
            </p>
            <button id="start-btn" class="btn-gradient hidden" style="width:100%;margin-top:16px;position:relative;z-index:9999;pointer-events:auto;cursor:pointer;">
                <span class="btn-icon">✅</span>
                <span id="start-btn-label">Siap!</span>
            </button>
        </div>

        <div class="feature-pills">
            <div class="feature-pill">🏆 Ranked Matches</div>
            <div class="feature-pill">⚡ 60 Detik</div>
            <div class="feature-pill">📊 Live Stats</div>
        </div>
    </div>
</div>

<!-- ══════════ GAME SCREEN ══════════ -->
<div id="game-screen" class="screen hidden">

    <div id="round-indicator">
        <span class="round-icon">⚔️</span>
        TYPING BATTLE
    </div>

    <div id="score-panel">
        <div class="score-panel-label">PROGRESS</div>
        <div class="prog-row me-prog">
            <div class="prog-name">
                <span id="my-name-label">Kamu</span>
                <span id="my-progress-label" class="prog-pct">0%</span>
            </div>
            <div class="prog-track">
                <div class="prog-fill" id="my-progress" style="width:0%"></div>
            </div>
        </div>
        <div id="opponents-progress"></div>
    </div>

    <div class="typing-arena">
        <div class="arena-scanline" aria-hidden="true"></div>
        <div class="arena-header">
            <span class="arena-tag">◉ LIVE</span>
            <span class="arena-hint">Ketik teks di bawah ini</span>
        </div>
        <div id="sentence-display">Teks akan muncul di sini...</div>
        <input id="typing-input" type="text"
               autocomplete="off" spellcheck="false"
               placeholder="Ketik di sini saat game dimulai...">
    </div>

    <div id="stats-panel">
        <div class="stat-card">
            <div class="stat-label">⏱ Sisa Waktu</div>
            <div class="stat-value" style="color:var(--accent-pink)">
                <span id="timer-display">60</span><span class="stat-unit">s</span>
            </div>
        </div>
        <div class="stat-divider" aria-hidden="true"></div>
        <div class="stat-card">
            <div class="stat-label">⚡ Live Speed</div>
            <div class="stat-value" style="color:var(--accent-green)">
                <span id="wpm-display">0</span><span class="stat-unit">WPM</span>
            </div>
        </div>
    </div>

</div>

<!-- ══════════ FINAL SCREEN ══════════ -->
<div id="final-screen" class="screen hidden">
    <div class="result-box">
        <div class="confetti-burst" aria-hidden="true">🏆</div>
        <h2 class="game-title final-title">MATCH OVER</h2>
        <p class="subtitle" style="margin-top:8px;margin-bottom:0;">Final Standings</p>
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Pemain</th>
                        <th>Total Skor</th>
                        <th>Avg WPM</th>
                        <th>Best WPM</th>
                        <th>Error Rate</th>
                    </tr>
                </thead>
                <tbody id="final-table-body"></tbody>
            </table>
        </div>
        <div style="display:flex;gap:12px;margin-top:24px;justify-content:center;flex-wrap:wrap;">
            <button id="play-again-btn" class="btn-gradient" style="min-width:180px;">
                <span class="btn-icon">🔄</span>
                <span>Main Lagi</span>
                <span class="btn-glow"></span>
            </button>
            <a href="public/dashboard.php" class="btn-glass" style="min-width:160px;display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;">
                <span>📊</span>
                <span>Dashboard</span>
            </a>
        </div>
    </div>
</div>

<script src="public/client.js"></script>
</body>
</html>
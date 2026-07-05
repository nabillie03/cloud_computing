/**
 * Typing Battle — Node.js WebSocket Server
 * Jalankan via: start-server.bat  ATAU  node ws-server.js
 *
 * Kompatibel dengan Laragon (MySQL root, no password).
 * Menyimpan skor ke tabel: players, matches, match_players
 */

'use strict';

const { WebSocketServer } = require('ws');
const mysql = require('mysql2');
const os    = require('os');

// ─── KONFIGURASI ─────────────────────────────────────────────────────────────
const PORT          = 8080;
const GAME_DURATION = 60; // detik

// Kumpulan kalimat yang dipilih secara acak setiap ronde
const KALIMAT_LIST = [
    "Perkembangan teknologi informasi yang pesat telah membawa perubahan besar dalam cara manusia bekerja dan berkomunikasi di seluruh penjuru dunia yang semakin terhubung satu sama lain.",
    "Kecerdasan buatan kini telah merambah berbagai sektor kehidupan manusia mulai dari kesehatan, pendidikan, hingga dunia bisnis dan diperkirakan akan terus membawa inovasi baru ke depannya.",
    "Kemampuan berpikir kritis dan analitis merupakan keterampilan penting yang harus dimiliki setiap individu agar mampu memilah informasi yang benar di tengah arus data yang terus membanjir.",
    "Penguasaan teknologi digital bukan lagi pilihan melainkan keharusan bagi siapa pun yang ingin tetap relevan dan mampu bersaing di pasar kerja internasional yang dinamis dan terus berubah.",
    "Pendidikan berkualitas adalah fondasi utama kemajuan bangsa karena melaluinya generasi muda dibekali pengetahuan dan karakter yang kuat untuk menghadapi tantangan masa depan yang kompleks.",
    "Revolusi industri keempat yang ditandai kemunculan otomasi dan kecerdasan buatan telah memaksa dunia kerja untuk beradaptasi dengan cepat agar tidak tertinggal dari laju perubahan zaman.",
    "Kebiasaan membaca secara rutin terbukti dapat memperluas wawasan, meningkatkan kemampuan kognitif, serta mempertajam daya analisis seseorang dalam menghadapi berbagai persoalan kehidupan.",
    "Sistem keamanan siber yang handal menjadi semakin penting seiring meningkatnya ketergantungan masyarakat terhadap layanan digital dan ancaman kejahatan siber yang semakin canggih setiap harinya.",
    "Kolaborasi lintas disiplin ilmu antara peneliti, insinyur, dan pelaku bisnis terbukti mampu menghasilkan inovasi yang lebih berdampak luas bagi masyarakat dibanding pendekatan satu bidang saja.",
    "Transformasi digital yang berlangsung di hampir seluruh industri menuntut setiap profesional untuk terus memperbarui kompetensinya dan mengembangkan pola pikir yang terbuka terhadap perubahan.",
    "Infrastruktur teknologi yang kuat dan merata merupakan prasyarat penting bagi terwujudnya masyarakat digital yang inklusif sehingga semua warga dapat menikmati manfaat kemajuan teknologi.",
    "Kemajuan di bidang bioteknologi dan kedokteran telah membuka kemungkinan baru dalam penanganan berbagai penyakit kronis yang selama ini dianggap sulit disembuhkan oleh metode konvensional.",
];

// ─── HELPER: Ambil IP LAN ────────────────────────────────────────────────────
function getLocalIP() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '127.0.0.1';
}

function randomKalimat() {
    return KALIMAT_LIST[Math.floor(Math.random() * KALIMAT_LIST.length)];
}

// ─── DATABASE (mysql2 — Laragon) ─────────────────────────────────────────────
const db = mysql.createPool({
    host      : 'localhost',
    port      : 3306,
    user      : 'root',
    password  : '',          // Laragon default: kosong
    database  : 'typing_battle',
    charset   : 'utf8mb4',
    waitForConnections: true,
    connectionLimit   : 10,
});

// Test koneksi + auto-migrate kolom backspace_count
db.getConnection((err, conn) => {
    if (err) {
        console.error('❌ Gagal konek ke database:', err.message);
        console.warn('   Pastikan Laragon MySQL sudah hidup dan database "typing_battle" sudah dibuat!');
        console.warn('   Jalankan setup_database.sql di HeidiSQL terlebih dahulu.\n');
    } else {
        console.log('✅ Terhubung ke Database (typing_battle) via Laragon MySQL!');
        // Auto-migrate: tambah kolom backspace_count di match_players jika belum ada
        conn.query(
            `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = 'typing_battle'
               AND TABLE_NAME   = 'match_players'
               AND COLUMN_NAME  = 'backspace_count'`,
            (err2, rows) => {
                if (!err2 && rows[0].cnt === 0) {
                    conn.query(
                        'ALTER TABLE match_players ADD COLUMN backspace_count INT DEFAULT 0',
                        (err3) => {
                            if (err3) console.warn('⚠️  Gagal tambah kolom backspace_count:', err3.message);
                            else console.log('✅ Kolom backspace_count ditambahkan ke match_players');
                            conn.release();
                        }
                    );
                } else {
                    console.log('✅ Kolom backspace_count sudah ada.');
                    conn.release();
                }
            }
        );
    }
});

// ─── DB HELPERS ──────────────────────────────────────────────────────────────

/** Simpan / update best WPM pemain */
function savePlayerScore(username, wpm) {
    if (!username || wpm <= 0) return;
    db.query(
        `INSERT INTO players (username, best_wpm, total_matches, last_played)
         VALUES (?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE
           best_wpm      = GREATEST(best_wpm, VALUES(best_wpm)),
           total_matches = total_matches + 1,
           last_played   = NOW()`,
        [username, wpm],
        (err) => { if (err) console.warn('⚠️  savePlayerScore:', err.message); }
    );
}

/** Tandai pemenang (tambah total_wins) */
function recordWin(username) {
    if (!username) return;
    db.query(
        `UPDATE players SET total_wins = total_wins + 1 WHERE username = ?`,
        [username],
        (err) => { if (err) console.warn('⚠️  recordWin:', err.message); }
    );
}

/** Simpan pertandingan ke tabel matches + match_players */
function saveMatch(standings) {
    if (!standings || standings.length === 0) return;

    const winner = standings[0]?.username || null;

    db.query(
        `INSERT INTO matches (winner, end_time) VALUES (?, NOW())`,
        [winner],
        (err, result) => {
            if (err) { console.warn('⚠️  saveMatch insert matches:', err.message); return; }
            const matchId = result.insertId;

            // Insert semua pemain
            const rows = standings.map((s, i) => [matchId, s.username, s.avgWpm, s.avgAccuracy, i + 1, s.backspaceCount || 0]);
            db.query(
                `INSERT INTO match_players (match_id, username, wpm, accuracy, \`rank\`, backspace_count) VALUES ?`,
                [rows],
                (err2) => { if (err2) console.warn('⚠️  saveMatch insert match_players:', err2.message); }
            );

            // Update statistik setiap pemain
            for (const s of standings) {
                savePlayerScore(s.username, s.avgWpm);
            }
            if (winner) recordWin(winner);

            console.log(`💾 Pertandingan #${matchId} disimpan. Juara: ${winner}`);
        }
    );
}

// ─── GAME STATE ──────────────────────────────────────────────────────────────
// players: Map<id, { ws, username, progress, wpm, selesai, totalErrors, accuracy }>
const players        = new Map();
let currentPhase     = 'lobby';
let currentSentence  = '';
let timeLeft         = GAME_DURATION;
let gameStartTime    = null;
let gameTimerInterval = null;
let nextId           = 1;

// ─── WEBSOCKET SERVER ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

wss.on('listening', () => {
    const ip = getLocalIP();
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║        🎮  TYPING BATTLE  |  WebSocket Server  🎮        ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  🖥️  Lokal  : ws://localhost:${PORT}                        ║`);
    console.log(`║  🌐  LAN   : ws://${ip}:${PORT}                    ║`);
    console.log('║                                                          ║');
    console.log(`║  📱  Buka Game : http://localhost/TYPING-BATTLE/         ║`);
    console.log(`║  📱  LAN Game  : http://${ip}/TYPING-BATTLE/    ║`);
    console.log('║                                                          ║');
    console.log('║  ⚠️   Semua device harus di WiFi / hotspot yang SAMA!    ║');
    console.log('║  🛑   Tekan CTRL+C untuk mematikan server.               ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
});

wss.on('connection', (ws) => {
    const id = nextId++;
    ws.playerId = id;
    players.set(id, {
        ws,
        username       : null,
        progress       : 0,
        wpm            : 0,
        selesai        : false,
        totalErrors    : 0,
        accuracy       : 100,
        ready          : false,
        lastReadyMs    : 0,
        backspaceCount : 0,
    });
    console.log(`👤 Koneksi baru (ID: ${id}) | Total: ${players.size}`);

    ws.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw.toString()); } catch { return; }
        handleMessage(id, ws, data);
    });

    ws.on('close', () => {
        const p    = players.get(id);
        const name = p?.username ?? `ID ${id}`;
        players.delete(id);
        console.log(`👋 ${name} keluar | Sisa: ${players.size}`);

        if (players.size === 0) {
            resetGame();
        } else if (currentPhase === 'playing') {
            const active    = activePlayers();
            const remaining = active.filter(p => !p.selesai);
            if (active.length > 0 && remaining.length === 0) {
                cancelTimer();
                endGame();
                return;
            }
        }
        sendGameState();
    });

    ws.on('error', (err) => console.error(`❌ WS Error (ID ${id}):`, err.message));
});

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
function handleMessage(id, ws, data) {
    if (!data?.type) return;
    const player = players.get(id);
    if (!player) return;

    switch (data.type) {

        case 'JOIN': {
            const username = sanitize(data.username);
            if (!username) return;
            player.username = username;
            console.log(`🎮 ${username} bergabung ke lobby.`);

            // Daftarkan ke DB jika belum ada
            db.query(
                `INSERT INTO players (username) VALUES (?)
                 ON DUPLICATE KEY UPDATE username = username`,
                [username],
                (err) => { if (err) console.warn('DB JOIN:', err.message); }
            );
            sendGameState();
            break;
        }

        case 'READY_TOGGLE': {
            if (currentPhase !== 'lobby') break;
            if (!player.username) break;
            // Debounce: abaikan jika dikirim < 800ms dari toggle terakhir
            const now = Date.now();
            if (now - player.lastReadyMs < 800) break;
            player.lastReadyMs = now;
            player.ready = !player.ready;
            console.log(`✅ ${player.username} ${player.ready ? 'SIAP' : 'BATAL SIAP'}`);

            // Cek apakah semua pemain sudah siap (minimal 2)
            const joined = activePlayers();
            const allReady = joined.length >= 2 && joined.every(p => p.ready);
            if (allReady) {
                startMatch();
            } else {
                sendGameState();
            }
            break;
        }

        case 'INPUT': {
            if (currentPhase !== 'playing') break;

            const typedText      = String(data.typedText || '');
            const totalErrors    = Math.max(0, parseInt(data.totalErrors) || 0);
            const backspaceCount = Math.max(0, parseInt(data.backspaceCount) || 0);
            const sentenceLen = currentSentence.length;
            const typedLen    = typedText.length;

            // Hitung progress
            const progress = sentenceLen > 0
                ? Math.min(100, (typedLen / sentenceLen) * 100)
                : 0;

            // Hitung WPM berbasis waktu server
            const elapsed     = gameStartTime ? Math.max(1, (Date.now() - gameStartTime) / 1000) : 1;
            let correctChars  = 0;
            for (let i = 0; i < typedLen; i++) {
                if (currentSentence[i] && typedText[i] === currentSentence[i]) correctChars++;
            }
            const wpm      = Math.max(0, Math.round((correctChars / 5) / (elapsed / 60)));
            const accuracy = typedLen > 0
                ? Math.max(0, Math.min(100, Math.round(((typedLen - totalErrors) / typedLen) * 100)))
                : 100;

            player.progress       = Math.round(progress * 10) / 10;
            player.wpm            = wpm;
            player.selesai        = progress >= 100;
            player.totalErrors    = totalErrors;
            player.accuracy       = accuracy;
            player.backspaceCount = backspaceCount;

            // Cek apakah semua selesai
            const active    = activePlayers();
            const remaining = active.filter(p => !p.selesai);
            if (active.length > 0 && remaining.length === 0) {
                cancelTimer();
                endGame();
                return;
            }

            sendGameState();
            break;
        }
    }
}

// ─── START MATCH ─────────────────────────────────────────────────────────────
function startMatch() {
    currentPhase    = 'playing';
    currentSentence = randomKalimat();
    console.log(`🚦 Pertandingan dimulai! Kalimat: "${currentSentence.substring(0, 40)}..."`);

    for (const p of players.values()) {
        p.progress       = 0;
        p.wpm            = 0;
        p.selesai        = false;
        p.totalErrors    = 0;
        p.accuracy       = 100;
        p.ready          = false;
        p.backspaceCount = 0;
    }

    broadcastAll({ type: 'START_GAME', kalimat: currentSentence });
    startGameTimer();
    sendGameState();
}

// ─── TIMER ───────────────────────────────────────────────────────────────────
function startGameTimer() {
    cancelTimer();
    timeLeft      = GAME_DURATION;
    gameStartTime = Date.now();

    gameTimerInterval = setInterval(() => {
        timeLeft--;
        broadcastAll({ type: 'TIMER', waktu: Math.max(0, timeLeft) });
        if (timeLeft <= 0) {
            cancelTimer();
            endGame();
        }
    }, 1000);
}

function cancelTimer() {
    if (gameTimerInterval !== null) {
        clearInterval(gameTimerInterval);
        gameTimerInterval = null;
    }
}

// ─── END GAME ────────────────────────────────────────────────────────────────
function endGame() {
    console.log('🏁 Game selesai! Menghitung hasil...');

    const standings = activePlayers()
        .map(p => ({
            username      : p.username,
            totalScore    : p.wpm,
            avgWpm        : p.wpm,
            bestWpm       : p.wpm,
            avgAccuracy   : p.accuracy,
            backspaceCount: p.backspaceCount,
        }))
        .sort((a, b) => b.avgWpm - a.avgWpm);

    // Simpan ke database
    saveMatch(standings);

    broadcastAll({ type: 'GAME_OVER_STATS', finalStandings: standings });

    // Reset ke lobby
    resetGame();
    console.log('🔄 Server kembali ke lobby.');
    sendGameState();
}

function resetGame() {
    cancelTimer();
    currentPhase    = 'lobby';
    currentSentence = '';
    timeLeft        = GAME_DURATION;
    gameStartTime   = null;
    for (const p of players.values()) {
        p.progress       = 0;
        p.wpm            = 0;
        p.selesai        = false;
        p.totalErrors    = 0;
        p.accuracy       = 100;
        p.ready          = false;
        p.backspaceCount = 0;
    }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function activePlayers() {
    return [...players.values()].filter(p => p.username !== null);
}

function sanitize(str) {
    return String(str || '').trim().replace(/<[^>]*>/g, '').substring(0, 30);
}

function broadcastAll(data) {
    const msg = JSON.stringify(data);
    for (const p of players.values()) {
        if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
    }
}

function sendGameState() {
    const playersData = activePlayers().map(p => ({
        username: p.username,
        progress: p.progress,
        wpm     : p.wpm,
        selesai : p.selesai,
        ready   : p.ready,
    }));

    const payload = {
        type   : 'GAME_STATE',
        phase  : currentPhase,
        players: playersData,
    };

    if (currentPhase === 'playing') {
        payload.waktu = Math.max(0, timeLeft);
    }

    broadcastAll(payload);
}
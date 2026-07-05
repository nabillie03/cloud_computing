(() => {
    'use strict';

    // ─── KONFIGURASI ─────────────────────────────────────────────────────────
    // Otomatis gunakan hostname yang sama (localhost atau IP LAN)
    const WS_URL = `ws://${location.hostname}:8080`;

    // ─── DOM ─────────────────────────────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);

    const DOM = {
        screenLobby          : $('#lobby-screen'),
        screenGame           : $('#game-screen'),
        screenFinal          : $('#final-screen'),
        inputUsername        : $('#username-input'),
        btnJoinMulti         : $('#join-multi-btn'),
        btnJoinSolo          : $('#join-solo-btn'),
        playerListContainer  : $('#player-list-container'),
        playerCount          : $('#player-count'),
        playerList           : $('#player-list'),
        statusText           : $('#status-text'),
        btnStartManual       : $('#start-btn'),
        hudTimer             : $('#timer-display'),
        hudWpm               : $('#wpm-display'),
        sentenceDisplay      : $('#sentence-display'),
        typingInput          : $('#typing-input'),
        myProgressLabel      : $('#my-progress-label'),
        myProgressBar        : $('#my-progress'),
        myNameLabel          : $('#my-name-label'),
        opponentsProgress    : $('#opponents-progress'),
        finalTableBody       : $('#final-table-body'),
        btnPlayAgain         : $('#play-again-btn'),
        wsStatusBar          : $('#ws-status-bar'),
    };

    // ─── STATE ───────────────────────────────────────────────────────────────
    let ws                = null;
    let wsReconnectTimer  = null;
    let localTimerInt     = null;
    let isSoloMode        = false;
    let myUsername        = '';
    let currentSentence   = '';
    let isFinished        = false;
    let totalErrors       = 0;
    let errorTracked      = new Set();
    let gameActive        = false;
    let backspaceCount    = 0;
    let _prevTypedLen     = 0;
    let pendingJoin       = null;   // username menunggu WS terbuka
    let timeLeft          = 60;
    let timeElapsed       = 0;

    // ─── WS STATUS BAR ───────────────────────────────────────────────────────
    function setWsStatus(status) {
        const el = DOM.wsStatusBar;
        if (!el) return;
        const map = {
            connecting   : { icon: '🟡', text: 'Menghubungkan ke server WebSocket...' },
            connected    : { icon: '🟢', text: 'Server terhubung ✓' },
            disconnected : { icon: '🔴', text: 'Server tidak terhubung — jalankan start-server.bat!' },
        };
        const { icon, text } = map[status] || map.disconnected;
        el.dataset.status = status;
        el.innerHTML = `${icon} <span>${text}</span>`;
    }

    // ─── UTILITIES ───────────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function showScreen(el) {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        el.classList.remove('hidden');
    }

    function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    }
    // Expose ke window agar fallback script di index.php bisa akses
    window.__tbSend = send;

    function triggerShake() {
        const arena = DOM.sentenceDisplay?.closest('.typing-arena');
        if (!arena) return;
        arena.classList.remove('shake');
        void arena.offsetWidth;
        arena.classList.add('shake');
        setTimeout(() => arena.classList.remove('shake'), 200);
    }

    function updateTimerUI(val) {
        if (DOM.hudTimer) DOM.hudTimer.textContent = val;
        if (DOM.hudTimer?.parentElement)
            DOM.hudTimer.parentElement.style.color = val <= 5 ? 'var(--accent-pink)' : '#fff';
    }

    // ─── RENDER KALIMAT ───────────────────────────────────────────────────────
    function renderSentence(typed, sentence) {
        if (!DOM.sentenceDisplay) return;
        let html = '';
        for (let i = 0; i < sentence.length; i++) {
            // Gunakan spasi biasa agar browser bisa word-wrap dengan benar
            // Tampilkan dengan &nbsp; hanya di dalam span agar tidak collapse
            const isSpace = sentence[i] === ' ';
            const ch = isSpace ? '&nbsp;' : escapeHtml(sentence[i]);
            let cls = '';
            if (i < typed.length)  cls = typed[i] === sentence[i] ? 'correct' : 'wrong';
            if (i === typed.length && !isFinished) cls += ' current';

            if (isSpace) {
                // Spasi: pakai span dengan word-break opportunity agar bisa wrap
                html += `<span class="${cls.trim()}" style="display:inline"> </span>`;
            } else {
                html += `<span class="${cls.trim()}">${ch}</span>`;
            }
        }
        DOM.sentenceDisplay.innerHTML = html;

        // Auto-scroll agar karakter aktif selalu terlihat
        const currentSpan = DOM.sentenceDisplay.querySelector('.current');
        if (currentSpan) {
            currentSpan.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    // ─── SOUND EFFECTS ───────────────────────────────────────────────────────
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) audioCtx = new AudioCtx();
        return audioCtx;
    }
    function playSound(type) {
        try {
            const ctx = getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            const now = ctx.currentTime;
            if (type === 'correct') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.exponentialRampToValueAtTime(660, now + 0.06);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
                osc.start(now); osc.stop(now + 0.07);
            } else if (type === 'wrong') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(180, now);
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc.start(now); osc.stop(now + 0.12);
            } else if (type === 'countdown') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now); osc.stop(now + 0.15);
            } else if (type === 'go') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.setValueAtTime(1100, now + 0.1);
                gain.gain.setValueAtTime(0.22, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                osc.start(now); osc.stop(now + 0.35);
            } else if (type === 'finish') {
                [523, 659, 784, 1047].forEach((freq, i) => {
                    const o = ctx.createOscillator(), g = ctx.createGain();
                    o.connect(g); g.connect(ctx.destination);
                    o.type = 'sine';
                    o.frequency.setValueAtTime(freq, now + i * 0.13);
                    g.gain.setValueAtTime(0.18, now + i * 0.13);
                    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.13 + 0.2);
                    o.start(now + i * 0.13); o.stop(now + i * 0.13 + 0.2);
                });
            }
        } catch (_) {}
    }

    // ─── COUNTDOWN ───────────────────────────────────────────────────────────
    function showCountdown(onDone) {
        let overlay = document.getElementById('countdown-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'countdown-overlay';
            overlay.style.cssText = [
                'position:fixed','inset:0','z-index:9999',
                'display:flex','flex-direction:column',
                'align-items:center','justify-content:center',
                'background:rgba(13,13,20,0.85)',
                'backdrop-filter:blur(6px)',
                "font-family:'Fredoka',sans-serif"
            ].join(';');
            document.body.appendChild(overlay);
        }
        const steps = [
            { label:'3', color:'#FF6B35' },
            { label:'2', color:'#FFB830' },
            { label:'1', color:'#06D6FE' },
            { label:'GO!', color:'#00FF88' },
        ];
        let i = 0;
        overlay.style.display = 'flex';
        function tick() {
            if (i >= steps.length) { overlay.style.display = 'none'; onDone(); return; }
            const s = steps[i];
            overlay.innerHTML = '<div style="' +
                'font-size:clamp(5rem,18vw,10rem);font-weight:700;' +
                'color:' + s.color + ';' +
                'text-shadow:0 0 60px ' + s.color + '99,0 0 120px ' + s.color + '44;' +
                'animation:cdPop 0.35s cubic-bezier(0.34,1.56,0.64,1) both;' +
                'letter-spacing:4px;' +
            '">' + s.label + '</div>' +
            '<style>@keyframes cdPop{from{transform:scale(0.3);opacity:0;}to{transform:scale(1);opacity:1;}}</style>';
            playSound(s.label === 'GO!' ? 'go' : 'countdown');
            i++;
            setTimeout(tick, s.label === 'GO!' ? 800 : 900);
        }
        tick();
    }

    // ─── SOLO MODE ───────────────────────────────────────────────────────────
    const SOLO_SENTENCES = [
        "Latihan mengetik setiap hari akan membuat kecepatan dan akurasi kamu semakin meningkat.",
        "Kecepatan mengetik yang baik adalah aset berharga di era digital yang semakin maju ini.",
        "Komputer adalah alat yang sangat berguna bagi manusia dalam menyelesaikan berbagai pekerjaan.",
    ];

    function startSoloGame() {
        const sentence    = SOLO_SENTENCES[Math.floor(Math.random() * SOLO_SENTENCES.length)];
        currentSentence   = sentence;
        isFinished        = false;
        gameActive        = true;
        totalErrors       = 0;
        errorTracked      = new Set();
        timeLeft          = 60;
        timeElapsed       = 0;

        DOM.typingInput.value    = '';
        DOM.typingInput.disabled = false;
        DOM.hudTimer.textContent = '60';
        DOM.hudWpm.textContent   = '0';
        DOM.myProgressBar.style.width  = '0%';
        DOM.myProgressLabel.textContent = '0%';
        if (DOM.myNameLabel) DOM.myNameLabel.textContent = myUsername || 'Kamu';

        DOM.typingInput.disabled = true;
        showScreen(DOM.screenGame);
        if (DOM.sentenceDisplay) DOM.sentenceDisplay.scrollTop = 0;
        renderSentence('', currentSentence);

        showCountdown(() => {
            DOM.typingInput.disabled = false;
            setTimeout(() => DOM.typingInput.focus(), 50);

        // Timer lokal
        if (localTimerInt) clearInterval(localTimerInt);
        localTimerInt = setInterval(() => {
            if (isFinished) { clearInterval(localTimerInt); return; }
            timeLeft--;
            timeElapsed++;
            updateTimerUI(timeLeft);

            const typed = DOM.typingInput.value;
            let correct = 0;
            for (let i = 0; i < typed.length; i++) {
                if (typed[i] === currentSentence[i]) correct++;
            }
            const wpm = timeElapsed > 0 ? Math.round((correct / 5) / (timeElapsed / 60)) : 0;
            DOM.hudWpm.textContent = wpm;

            const pct = Math.min(100, (typed.length / currentSentence.length) * 100);
            DOM.myProgressBar.style.width      = `${pct}%`;
            DOM.myProgressLabel.textContent    = `${Math.round(pct)}%`;

            if (timeLeft <= 0 || typed.length >= currentSentence.length) {
                isFinished = true;
                clearInterval(localTimerInt);
                DOM.typingInput.disabled = true;
                setTimeout(() => showSoloResult(wpm), 500);
            }
        }, 1000);
        }); // end showCountdown
    }

    function showSoloResult(wpm) {
        playSound('finish');
        const accuracy = Math.max(0, 100 - (totalErrors * 2));
        const score    = Math.round(wpm * (accuracy / 100));
        if (DOM.finalTableBody) {
            DOM.finalTableBody.innerHTML = `
            <tr>
                <td>🥇</td>
                <td style="color:var(--accent-cyan);font-weight:bold;">${escapeHtml(myUsername)}</td>
                <td>${score}</td>
                <td>${wpm}</td>
                <td>${wpm}</td>
                <td>${Math.max(0, 100 - accuracy)}%</td>
            </tr>`;
        }
        showScreen(DOM.screenFinal);
    }

    // ─── WEBSOCKET ───────────────────────────────────────────────────────────
    function connect() {
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
        setWsStatus('connecting');
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('[WS] Terhubung ke', WS_URL);
            setWsStatus('connected');
            if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

            // Kirim JOIN yang tertunda jika ada
            if (pendingJoin && !isSoloMode) {
                send({ type: 'JOIN', username: pendingJoin });
                pendingJoin = null;
            }
        };

        ws.onclose = () => {
            console.warn('[WS] Koneksi terputus.');
            setWsStatus('disconnected');
            if (!isSoloMode) wsReconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => setWsStatus('disconnected');

        ws.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch { return; }
            handleServerMessage(data);
        };
    }

    // ─── HANDLE PESAN DARI SERVER ─────────────────────────────────────────────
    function handleServerMessage(data) {
        switch (data.type) {
            case 'GAME_STATE'     : onGameState(data);  break;
            case 'START_GAME'     : onStartGame(data);  break;
            case 'TIMER'          : updateTimerUI(data.waktu); break;
            case 'GAME_OVER_STATS': onGameOver(data);   break;
            case 'ERROR'          : alert(data.message);break;
        }
    }

    function onGameState(data) {
        if (data.phase === 'lobby') {
            // Tampilkan container lobby
            DOM.playerListContainer.classList.remove('hidden');
            DOM.playerCount.textContent = `(${data.players.length}/5)`;

            // Render daftar pemain
            DOM.playerList.innerHTML = data.players.map(p => {
                const isMe   = p.username === myUsername;
                const rdyTag = p.ready
                    ? '<span class="ready-badge ready-yes">✔ SIAP</span>'
                    : '<span class="ready-badge ready-no">⏳ Belum</span>';
                return `<li class="${isMe ? 'me' : ''}">${isMe ? '👉 ' : '👤 '}${escapeHtml(p.username)} ${rdyTag}</li>`;
            }).join('');

            // Selalu tampilkan tombol siap jika sudah join (myUsername terisi)
            if (myUsername) {
                const me       = data.players.find(p => p.username === myUsername);
                const iAmReady = me ? me.ready : false;

                // Hapus hidden & set style langsung di element
                DOM.btnStartManual.removeAttribute('disabled');
                DOM.btnStartManual.style.display       = 'block';
                DOM.btnStartManual.style.width         = '100%';
                DOM.btnStartManual.style.marginTop     = '16px';
                DOM.btnStartManual.style.position      = 'relative';
                DOM.btnStartManual.style.zIndex        = '9999';
                DOM.btnStartManual.style.pointerEvents = 'auto';
                DOM.btnStartManual.style.cursor        = 'pointer';
                DOM.btnStartManual.style.background    = iAmReady
                    ? 'linear-gradient(135deg,#FF2D7A,#FF6B35)'
                    : 'linear-gradient(135deg,#00FF88,#06D6FE)';
                // Hapus class hidden terakhir setelah style display di-set
                DOM.btnStartManual.classList.remove('hidden');

                // Update teks tombol
                DOM.btnStartManual.innerHTML = iAmReady
                    ? '<span class="btn-icon">❌</span> <span id="start-btn-label">Batal Siap</span>'
                    : '<span class="btn-icon">✅</span> <span id="start-btn-label">Siap!</span>';

                // Event listener dipasang sekali di bagian EVENT LISTENERS
            }

            // Status teks
            const readyCount = data.players.filter(p => p.ready).length;
            const total      = data.players.length;
            DOM.statusText.classList.remove('hidden');
            DOM.statusText.innerHTML = total < 2
                ? '<span>Menunggu pemain lain bergabung...</span>'
                : `<span>${readyCount}/${total} pemain siap — semua harus siap untuk mulai</span>`;
        }

        if (data.phase === 'playing') {
            renderProgress(data.players);
        }
    }

    function renderProgress(players) {
        let oppHtml = '';
        players.forEach(p => {
            const pct = Math.min(100, Math.max(0, p.progress));
            const wpm = p.wpm ? Math.round(p.wpm) : 0;
            if (p.username === myUsername) {
                DOM.myProgressBar.style.width      = `${pct}%`;
                DOM.myProgressLabel.textContent    = `${Math.round(pct)}%`;
                DOM.hudWpm.textContent             = wpm;
                if (p.selesai && !isFinished) {
                    isFinished = true;
                    DOM.typingInput.disabled = true;
                    DOM.typingInput.blur();
                }
            } else {
                oppHtml += `
                <div class="prog-row">
                    <div class="prog-name">
                        <span>${escapeHtml(p.username)}</span>
                        <span>${p.selesai ? '✅ DONE' : `${Math.round(pct)}%`} · ${wpm} WPM</span>
                    </div>
                    <div class="prog-track">
                        <div class="prog-fill" style="width:${pct}%"></div>
                    </div>
                </div>`;
            }
        });
        DOM.opponentsProgress.innerHTML = oppHtml;
    }

    function onStartGame(data) {
        currentSentence = data.kalimat || '';
        isFinished      = false;
        gameActive      = true;
        totalErrors     = 0;
        errorTracked    = new Set();
        timeLeft        = 60;

        DOM.typingInput.value           = '';
        DOM.typingInput.disabled        = false;
        DOM.hudTimer.textContent        = '60';
        DOM.hudWpm.textContent          = '0';
        DOM.myProgressBar.style.width   = '0%';
        DOM.myProgressLabel.textContent = '0%';
        if (DOM.myNameLabel) DOM.myNameLabel.textContent = myUsername || 'Kamu';
        DOM.opponentsProgress.innerHTML = '';
        backspaceCount  = 0;
        _prevTypedLen   = 0;

        DOM.typingInput.disabled = true;
        showScreen(DOM.screenGame);

        // Reset scroll posisi kalimat ke awal, lalu render
        if (DOM.sentenceDisplay) DOM.sentenceDisplay.scrollTop = 0;
        renderSentence('', currentSentence);

        showCountdown(() => {
            DOM.typingInput.disabled = false;
            setTimeout(() => DOM.typingInput.focus(), 50);
        });
    }

    // ─── KONFETI ─────────────────────────────────────────────────────────────
    function launchConfetti(isWinner) {
        const colors = isWinner
            ? ['#FFD700','#FF6B35','#00FF88','#06D6FE','#FF2D7A','#FFB830']
            : ['#06D6FE','#00FF88','#9B59B6','#ffffff'];
        const count  = isWinner ? 160 : 60;
        const container = document.body;

        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'confetti-particle';
            const size  = Math.random() * 10 + 6;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const left  = Math.random() * 100;
            const delay = Math.random() * 1.2;
            const dur   = Math.random() * 2 + 2;
            const rotate= Math.random() * 720 - 360;
            const shape = Math.random() > 0.5 ? '50%' : '2px';
            el.style.cssText = [
                `position:fixed`,
                `left:${left}vw`,
                `top:-20px`,
                `width:${size}px`,
                `height:${size * (Math.random() * 0.6 + 0.5)}px`,
                `background:${color}`,
                `border-radius:${shape}`,
                `z-index:99999`,
                `pointer-events:none`,
                `animation:confettiFall ${dur}s ${delay}s ease-in forwards`,
                `transform:rotate(${rotate}deg)`,
            ].join(';');
            container.appendChild(el);
            setTimeout(() => el.remove(), (dur + delay + 0.5) * 1000);
        }
    }

    function getWinnerMessage(rank, wpm, username) {
        if (rank === 0) {
            if (wpm >= 60) return { title: '👑 LUAR BIASA!', sub: `${username} mendominasi arena dengan ${wpm} WPM!` };
            if (wpm >= 40) return { title: '🏆 JUARA!', sub: `${username} memenangkan pertandingan dengan ${wpm} WPM!` };
            return { title: '🥇 KAMU MENANG!', sub: `${username} tercepat hari ini dengan ${wpm} WPM!` };
        }
        if (rank === 1) return { title: '🥈 HAMPIR!', sub: `${username} peringkat 2 — latihan lagi yuk!` };
        if (rank === 2) return { title: '🥉 TIDAK BURUK!', sub: `${username} peringkat 3 — terus semangat!` };
        return { title: '💪 TETAP SEMANGAT!', sub: `${username} selesai di peringkat ${rank + 1} — kamu bisa lebih baik!` };
    }

    function showWinnerBanner(standings) {
        // Hapus banner lama jika ada
        const old = document.getElementById('winner-banner');
        if (old) old.remove();

        const myRank = standings.findIndex(s => s.username === myUsername);
        const myData = standings[myRank] || {};
        const isWinner = myRank === 0;
        const msg = getWinnerMessage(myRank, myData.avgWpm || 0, myUsername || 'Kamu');

        const banner = document.createElement('div');
        banner.id = 'winner-banner';
        banner.innerHTML = `
            <div class="wb-inner ${isWinner ? 'wb-winner' : 'wb-loser'}">
                <div class="wb-title">${msg.title}</div>
                <div class="wb-sub">${msg.sub}</div>
            </div>`;
        // Sisipkan sebelum tabel di final screen
        const resultBox = document.querySelector('.result-box');
        if (resultBox) {
            resultBox.insertBefore(banner, resultBox.querySelector('.table-wrapper'));
        }

        // Tunda konfeti sedikit agar screen sudah muncul
        setTimeout(() => launchConfetti(isWinner), 200);
    }

    function onGameOver(data) {
        gameActive  = false;
        isFinished  = true;
        if (localTimerInt) clearInterval(localTimerInt);
        DOM.typingInput.disabled = true;
        playSound('finish');

        const standings = data.finalStandings || [];
        if (DOM.finalTableBody) {
            DOM.finalTableBody.innerHTML = standings.map((s, i) => {
                const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                const isMe = s.username === myUsername;
                return `<tr>
                    <td>${rank}</td>
                    <td style="${isMe ? 'color:var(--accent-cyan);font-weight:bold;' : ''}">${escapeHtml(s.username)}</td>
                    <td>${s.totalScore}</td>
                    <td>${s.avgWpm}</td>
                    <td>${s.bestWpm}</td>
                    <td>${Math.max(0, 100 - (s.avgAccuracy ?? 100))}%</td>
                </tr>`;
            }).join('');
        }
        showScreen(DOM.screenFinal);
        // Tampilkan banner juara + konfeti
        showWinnerBanner(standings);
    }

    // ─── INPUT TYPING ─────────────────────────────────────────────────────────
    function onTypingInput() {
        if (isFinished || !currentSentence) return;
        let typed = DOM.typingInput.value;

        // Batasi panjang sesuai kalimat
        if (typed.length > currentSentence.length) {
            typed = typed.substring(0, currentSentence.length);
            DOM.typingInput.value = typed;
        }

        // Deteksi backspace (panjang berkurang)
        if (typed.length < _prevTypedLen) {
            backspaceCount += (_prevTypedLen - typed.length);
        }
        _prevTypedLen = typed.length;

        // Deteksi error + sound
        const prevLen = errorTracked.size;
        for (let i = 0; i < typed.length; i++) {
            if (typed[i] !== currentSentence[i] && !errorTracked.has(i)) {
                errorTracked.add(i);
                totalErrors++;
                triggerShake();
                playSound('wrong');
            }
        }
        // Suara ketukan benar hanya jika tidak ada error baru
        if (errorTracked.size === prevLen && typed.length > 0) {
            playSound('correct');
        }

        // Selalu render kalimat (baik solo maupun multiplayer)
        renderSentence(typed, currentSentence);

        if (!isSoloMode) {
            send({ type: 'INPUT', typedText: typed, totalErrors, backspaceCount });
        }
    }

    // ─── JOIN / START ─────────────────────────────────────────────────────────
    function doJoin(mode) {
        const username = DOM.inputUsername.value.trim();
        if (!username) { alert('Masukkan username kamu dulu! 👤'); return; }
        myUsername = username;
        try { localStorage.setItem('tb_lastUser', username); } catch (_) {}

        if (mode === 'solo') {
            isSoloMode = true;
            document.body.classList.add('solo-mode');
            startSoloGame();
        } else {
            isSoloMode = false;
            document.body.classList.remove('solo-mode');

            DOM.inputUsername.disabled = true;
            DOM.btnJoinMulti.disabled  = true;
            DOM.btnJoinSolo.disabled   = true;

            showScreen(DOM.screenLobby);
            DOM.playerListContainer.classList.remove('hidden');
            DOM.btnStartManual.classList.add('hidden'); // akan muncul saat ada 1+ pemain
            DOM.statusText.classList.remove('hidden');

            if (ws && ws.readyState === WebSocket.OPEN) {
                send({ type: 'JOIN', username });
            } else {
                pendingJoin = username;
                connect();
            }
        }
    }

    function resetToLobby() {
        gameActive  = false;
        isFinished  = false;
        isSoloMode  = false;
        myUsername  = '';
        currentSentence = '';
        document.body.classList.remove('solo-mode');

        if (localTimerInt) clearInterval(localTimerInt);
        DOM.typingInput.disabled   = false;
        DOM.typingInput.value      = '';
        DOM.inputUsername.disabled = false;
        DOM.inputUsername.value    = '';
        DOM.btnJoinMulti.disabled  = false;
        DOM.btnJoinSolo.disabled   = false;
        DOM.btnStartManual.classList.add('hidden');
        DOM.statusText.classList.remove('hidden');
        DOM.playerListContainer.classList.add('hidden');
        DOM.playerList.innerHTML   = '';

        showScreen(DOM.screenLobby);

        // Reconnect WS
        if (ws) ws.close();
        setTimeout(connect, 300);
    }

    // ─── EVENT LISTENERS ──────────────────────────────────────────────────────
    DOM.btnJoinMulti.addEventListener('click', () => doJoin('multi'));
    DOM.btnJoinSolo.addEventListener('click',  () => doJoin('solo'));
    DOM.inputUsername.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doJoin('multi');
    });

    DOM.btnStartManual?.addEventListener('click', () => {
        send({ type: 'READY_TOGGLE' });
    });
    // Catatan: listener di atas hanya dipasang SEKALI saat halaman load

    DOM.typingInput.addEventListener('input', onTypingInput);
    DOM.typingInput.addEventListener('paste', (e) => {
        e.preventDefault();
        alert('⛔ Dilarang copy-paste! Ketik sendiri ya 😤');
    });

    // Klik arena → fokus input
    DOM.sentenceDisplay?.closest('.typing-arena')?.addEventListener('click', () => {
        if (!DOM.typingInput.disabled) DOM.typingInput.focus();
    });

    DOM.btnPlayAgain?.addEventListener('click', resetToLobby);

    // ─── INISIALISASI ─────────────────────────────────────────────────────────
    try {
        const last = localStorage.getItem('tb_lastUser');
        if (last && DOM.inputUsername) DOM.inputUsername.value = last;
    } catch (_) {}

    connect();
    showScreen(DOM.screenLobby);
})();
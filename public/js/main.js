// Králové Sídliště – Hlavní klientský skript

const socket = io();

socket.on('connect', () => {
  console.log('Připojeno k serveru, socket ID:', socket.id);
});
socket.on('disconnect', () => {
  console.log('Odpojeno od serveru');
});

// ============================================
// Shared konstanty
// ============================================
const PLAYER_COLORS = ['#e94560', '#4a6cf7', '#2ecc71'];
const PLAYER_STROKES = ['#ff6b8a', '#7b93ff', '#5eff9e'];
const CIRCUMFERENCE = 2 * Math.PI * 34; // SVG timer ring

// ============================================
// Lobby modul
// ============================================
(function () {
  'use strict';

  const lobbyScreen  = document.getElementById('lobby-screen');
  const gameScreen   = document.getElementById('game-screen');
  const lobbyMenu    = document.getElementById('lobby-menu');
  const lobbyRoom    = document.getElementById('lobby-room');
  const nameInput    = document.getElementById('player-name-input');
  const codeInput    = document.getElementById('join-code-input');
  const btnCreate    = document.getElementById('btn-create-room');
  const btnJoin      = document.getElementById('btn-join-room');
  const btnLeave     = document.getElementById('btn-leave-room');
  const btnStart     = document.getElementById('btn-start-game');
  const lobbyError   = document.getElementById('lobby-error');
  const roomCodeVal  = document.getElementById('room-code-value');
  const playerList   = document.getElementById('lobby-player-list');
  const playerCount  = document.getElementById('lobby-player-count');

  let currentRoomCode = null;
  let isHost = false;

  function showError(msg) {
    lobbyError.textContent = msg;
    setTimeout(() => { if (lobbyError.textContent === msg) lobbyError.textContent = ''; }, 4000);
  }

  function getPlayerName() {
    const name = nameInput.value.trim();
    if (!name) { showError('Zadej přezdívku!'); nameInput.focus(); return null; }
    return name;
  }

  function renderPlayerList(players) {
    playerList.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'lobby-player-item';
      li.innerHTML = `
        <span class="player-dot" style="--player-color: ${PLAYER_COLORS[i] || '#888'}"></span>
        <span class="player-name">${p.name}</span>
        ${p.isHost ? '<span class="host-badge">Host</span>' : ''}
      `;
      playerList.appendChild(li);
    });
    playerCount.textContent = players.length;
  }

  function enterWaitingRoom(code, players, host) {
    currentRoomCode = code;
    isHost = host;
    roomCodeVal.textContent = code;
    renderPlayerList(players);
    lobbyMenu.style.display = 'none';
    lobbyRoom.style.display = 'block';
    btnStart.style.display = isHost ? 'block' : 'none';
  }

  // Vytvořit
  btnCreate.addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) return;
    socket.emit('create-room', name, (res) => {
      if (res.success) {
        console.log(`🏠 Místnost: ${res.code}`);
        enterWaitingRoom(res.code, res.players, true);
      } else showError(res.error);
    });
  });

  // Připojit
  btnJoin.addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) { showError('Kód musí mít 4 znaky.'); codeInput.focus(); return; }
    socket.emit('join-room', { code, playerName: name }, (res) => {
      if (res.success) {
        console.log(`🚪 Připojeno: ${res.code}`);
        enterWaitingRoom(res.code, res.players, false);
      } else showError(res.error);
    });
  });

  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnJoin.click(); });
  btnLeave.addEventListener('click', () => window.location.reload());

  // Spustit hru
  btnStart.addEventListener('click', () => {
    socket.emit('start-game', (res) => {
      if (!res.success) showError(res.error);
    });
  });

  // Socket events
  socket.on('player-joined', (data) => {
    renderPlayerList(data.players);
  });
  socket.on('player-left', (data) => {
    renderPlayerList(data.players);
  });

  // Hra zahájena – přepnout na herní obrazovku
  socket.on('game-started', (data) => {
    console.log('🎮 Hra zahájena!', data.players);
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'block';

    // Inicializovat mapu a scoreboard
    if (typeof window.initMap === 'function') window.initMap();
    if (typeof window.initGameScoreboard === 'function') window.initGameScoreboard(data.players);
  });
})();

// ============================================
// Interaktivní mapa
// ============================================
(function () {
  'use strict';

  function initMap() {
    const map = document.getElementById('prague-map');
    if (!map) return;

    const tooltip     = document.getElementById('district-tooltip');
    const tooltipName = document.getElementById('tooltip-name');
    const infoPanel   = document.getElementById('info-panel');
    const panelName   = document.getElementById('panel-district-name');
    const panelStatus = document.getElementById('panel-district-status');
    const closeBtn    = document.getElementById('panel-close-btn');
    let selectedDistrict = null;

    function addDistrictLabels() {
      // zabránit duplicitám
      if (map.querySelector('.district-label')) return;
      map.querySelectorAll('.district').forEach(d => {
        const bb = d.getBBox();
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'district-label');
        label.setAttribute('x', bb.x + bb.width / 2);
        label.setAttribute('y', bb.y + bb.height / 2);
        label.setAttribute('data-for', d.id);
        label.textContent = d.dataset.district;
        map.appendChild(label);
      });
    }

    function showTooltip(e, name) {
      tooltipName.textContent = name;
      tooltip.classList.remove('hidden');
      tooltip.classList.add('visible');
      positionTooltip(e);
    }
    function hideTooltip() {
      tooltip.classList.remove('visible');
      tooltip.classList.add('hidden');
    }
    function positionTooltip(e) {
      const rect = document.getElementById('map-container').getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 16) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
    }
    function showPanel(name) {
      panelName.textContent = name;
      panelStatus.textContent = 'Nezabráno – klikni pro zabrání';
      infoPanel.classList.remove('hidden');
      infoPanel.classList.add('visible');
    }
    function hidePanel() {
      infoPanel.classList.remove('visible');
      infoPanel.classList.add('hidden');
    }

    map.querySelectorAll('.district').forEach(district => {
      district.addEventListener('mouseenter', e => {
        showTooltip(e, district.dataset.name);
        const lbl = map.querySelector(`.district-label[data-for="${district.id}"]`);
        if (lbl) lbl.classList.add('label-hover');
      });
      district.addEventListener('mousemove', e => positionTooltip(e));
      district.addEventListener('mouseleave', () => {
        hideTooltip();
        const lbl = map.querySelector(`.district-label[data-for="${district.id}"]`);
        if (lbl) lbl.classList.remove('label-hover');
      });
      district.addEventListener('click', () => {
        // Pokud jsme v attack selection mode
        if (window._attackSelectMode) {
          window._handleAttackDistrictClick(district.id);
          return;
        }
        // Pokud jsme v selection mode (výběr území)
        if (window._selectionMode) {
          window._handleDistrictSelection(district.id);
          return;
        }
        if (selectedDistrict) selectedDistrict.classList.remove('selected');
        if (selectedDistrict === district) { selectedDistrict = null; hidePanel(); }
        else { selectedDistrict = district; district.classList.add('selected'); showPanel(district.dataset.name); }
      });
    });

    if (closeBtn) closeBtn.addEventListener('click', () => {
      if (selectedDistrict) { selectedDistrict.classList.remove('selected'); selectedDistrict = null; }
      hidePanel();
    });

    addDistrictLabels();
    console.log('🗺️ Mapa inicializována');
  }

  window.initMap = initMap;
})();

// ============================================
// Herní logika (kvíz + mapa + scoreboard + attack)
// ============================================
(function () {
  'use strict';

  let roundStartTime = 0;
  let timerInterval  = null;
  let progressInterval = null;
  let timeLeft       = 0;
  let answered       = false;
  let totalTime      = 15;
  let currentQuestionType = 'choice';
  let isAttackPhase  = false;
  let mySelectedDistrict = null;  // čtvrť, kterou jsem si vybral v selection phase

  // --- Overlay DOM refs ---
  const quizOverlay     = document.getElementById('quiz-overlay');
  const overlayDistTag  = quizOverlay.querySelector('.quiz-overlay-district-tag');
  const overlayQuestion = quizOverlay.querySelector('.quiz-overlay-question');
  const overlayAnswers  = quizOverlay.querySelector('.quiz-overlay-answers');
  const overlayEstimate = quizOverlay.querySelector('.quiz-overlay-estimate');
  const estimateInput   = document.getElementById('estimate-input');
  const estimateUnit    = document.getElementById('estimate-unit');
  const estimateSubmitBtn = document.getElementById('estimate-submit-btn');
  const estimateResult  = document.getElementById('estimate-result');
  const overlayTimerText     = quizOverlay.querySelector('.timer-text');
  const overlayTimerProgress = quizOverlay.querySelector('.timer-progress');
  const overlayProgressBar   = quizOverlay.querySelector('.quiz-progress-bar');

  // --- Battle tracker DOM refs ---
  const battleTracker      = quizOverlay.querySelector('.attack-battle-tracker');
  const battleAttackerName = document.getElementById('battle-attacker-name');
  const battleDefenderName = document.getElementById('battle-defender-name');
  const battleAttackerScore = document.getElementById('battle-attacker-score');
  const battleDefenderScore = document.getElementById('battle-defender-score');

  // --- Attack select overlay ---
  const attackSelectOverlay = document.getElementById('attack-select-overlay');
  const attackSelectAttacker = document.getElementById('attack-select-attacker');
  const attackSelectCountdown = document.getElementById('attack-select-countdown');

  // --- Attack result overlay ---
  const attackResultOverlay = document.getElementById('attack-result-overlay');
  const attackResultTitle = document.getElementById('attack-result-title');
  const attackResultDetail = document.getElementById('attack-result-detail');

  // --- HUD info panel refs ---
  const hudPhaseBadge = document.getElementById('hud-phase-badge');
  const hudRound = document.getElementById('hud-round');
  const hudTurnInfo = document.getElementById('hud-turn-info');

  // --- Scoreboard init ---
  window.initGameScoreboard = function (players) {
    const list = document.getElementById('game-scoreboard-list');
    if (!list) return;
    list.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = `scoreboard-item player-${i + 1}`;
      li.setAttribute('data-player-index', i);
      li.innerHTML = `
        <span class="player-dot" style="--player-color: ${PLAYER_COLORS[i]}"></span>
        <span class="player-name">${p.name}</span>
        <span class="player-score">0</span>
      `;
      list.appendChild(li);
    });
  };

  // --- Aktualizace skóre ---
  function updateScores(scores) {
    const list = document.getElementById('game-scoreboard-list');
    if (!list) return;
    scores.forEach((s, i) => {
      const item = list.querySelector(`[data-player-index="${i}"]`);
      if (item) {
        item.querySelector('.player-score').textContent = s.score;
      }
    });
  }

  // --- Aktualizace mapy ---
  function updateMapOwnership(mapOwnership) {
    document.querySelectorAll('.district').forEach(d => {
      d.classList.remove('owned-player1', 'owned-player2', 'owned-player3', 'attackable');
      d.style.fill = '';
      d.style.stroke = '';
    });
    for (const [districtId, playerIndex] of Object.entries(mapOwnership)) {
      const el = document.getElementById(districtId);
      if (el) {
        el.classList.add(`owned-player${playerIndex + 1}`);
        el.style.fill = PLAYER_COLORS[playerIndex];
        el.style.stroke = PLAYER_STROKES[playerIndex];
      }
    }
  }

  // --- Aktualizace HUD info panelu ---
  function updateHUD(options) {
    if (hudPhaseBadge && options.phase !== undefined) {
      if (options.phase === 'conquest') {
        hudPhaseBadge.textContent = '🗺️ Dobývání';
        hudPhaseBadge.className = 'hud-phase-badge phase-conquest';
      } else if (options.phase === 'attack') {
        hudPhaseBadge.textContent = '⚔️ Útok';
        hudPhaseBadge.className = 'hud-phase-badge phase-attack';
      }
    }
    if (hudRound) {
      if (options.round === null) {
        hudRound.style.display = 'none';
      } else if (options.round !== undefined) {
        hudRound.style.display = 'block';
        hudRound.textContent = `Kolo ${options.round}`;
      }
    }
    if (hudTurnInfo && options.turnInfo !== undefined) {
      hudTurnInfo.textContent = options.turnInfo;
      hudTurnInfo.style.display = options.turnInfo ? 'block' : 'none';
    }
  }

  // --- Zvýrazni čtvrtě podle výběrů ---
  function highlightDistrictChoices(districtChoices, myPlayerId) {
    clearDistrictHighlight();
    for (const [socketId, districtId] of Object.entries(districtChoices)) {
      const el = document.getElementById(districtId);
      if (el) {
        el.classList.add('round-target');
        if (socketId === myPlayerId) {
          el.classList.add('selected-by-me');
        }
      }
    }
  }

  function clearDistrictHighlight() {
    document.querySelectorAll('.district.round-target, .district.selected, .district.selectable, .district.selected-by-me').forEach(d => {
      d.classList.remove('round-target', 'selected', 'selectable', 'selected-by-me');
    });
  }

  // --- Cleanup selection mode ---
  function cleanupSelectionMode() {
    window._selectionMode = false;
    if (window._selectionTimerInterval) {
      clearInterval(window._selectionTimerInterval);
      window._selectionTimerInterval = null;
    }
    document.querySelectorAll('.district.selectable, .district.selected-by-me').forEach(d => {
      d.classList.remove('selectable', 'selected-by-me');
    });
    const overlay = document.getElementById('selection-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ============================================
  // Quiz Overlay – show / hide
  // ============================================

  function showQuizOverlay(question, district, attackState) {
    answered = false;
    currentQuestionType = question.type || 'choice';

    // District name
    const districtEl = document.getElementById(district);
    const districtName = districtEl ? districtEl.dataset.name : district;
    overlayDistTag.textContent = `📍 ${districtName}`;

    // Question text
    overlayQuestion.textContent = question.question;

    // Show/hide battle tracker
    if (attackState) {
      battleTracker.style.display = 'flex';
      battleAttackerName.textContent = attackState.attackerName;
      battleDefenderName.textContent = attackState.defenderName;
      battleAttackerScore.textContent = attackState.scores.attacker;
      battleDefenderScore.textContent = attackState.scores.defender;
    } else {
      battleTracker.style.display = 'none';
    }

    // Render based on question type
    if (currentQuestionType === 'choice') {
      overlayAnswers.style.display = 'grid';
      overlayEstimate.style.display = 'none';

      // Answer buttons
      overlayAnswers.innerHTML = '';
      const keys = ['A', 'B', 'C', 'D'];
      question.options.forEach((option, i) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-answer-btn';
        btn.dataset.index = i;
        btn.innerHTML = `
          <span class="answer-key">${keys[i]}</span>
          <span class="answer-text">${option}</span>
        `;
        btn.addEventListener('click', () => submitAnswer(i, btn));
        overlayAnswers.appendChild(btn);
      });
    } else {
      // Estimate question
      overlayAnswers.style.display = 'none';
      overlayEstimate.style.display = 'block';
      estimateInput.value = '';
      estimateUnit.textContent = question.unit || '';
      estimateResult.style.display = 'none';
      estimateInput.disabled = false;
      estimateSubmitBtn.disabled = false;
      estimateSubmitBtn.textContent = '📤 Odeslat tip';

      // Focus on input
      setTimeout(() => estimateInput.focus(), 100);
    }

    // Reset progress bar
    overlayProgressBar.style.width = '100%';
    overlayProgressBar.className = 'quiz-progress-bar';

    // Show overlay
    quizOverlay.classList.remove('quiz-overlay-hiding');
    quizOverlay.style.display = 'flex';
  }

  function hideQuizOverlay() {
    return new Promise((resolve) => {
      quizOverlay.classList.add('quiz-overlay-hiding');
      setTimeout(() => {
        quizOverlay.style.display = 'none';
        quizOverlay.classList.remove('quiz-overlay-hiding');
        resolve();
      }, 350);
    });
  }

  // ============================================
  // Timer + Progress Bar
  // ============================================

  function startTimer(seconds) {
    totalTime = seconds;
    timeLeft = seconds;
    updateTimerDisplay();

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeLeft--;
      updateTimerDisplay();
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }, 1000);

    startProgressBar(seconds);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
  }

  function updateTimerDisplay() {
    if (!overlayTimerText || !overlayTimerProgress) return;

    overlayTimerText.textContent = Math.max(0, timeLeft);
    const fraction = Math.max(0, timeLeft) / totalTime;
    overlayTimerProgress.style.strokeDasharray = CIRCUMFERENCE;
    overlayTimerProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - fraction);

    if (timeLeft > 8) overlayTimerProgress.style.stroke = '#2ecc71';
    else if (timeLeft > 4) overlayTimerProgress.style.stroke = '#f5c542';
    else overlayTimerProgress.style.stroke = '#e94560';
  }

  function startProgressBar(seconds) {
    if (progressInterval) clearInterval(progressInterval);

    const totalMs = seconds * 1000;
    const startMs = Date.now();
    const updateRate = 50;

    overlayProgressBar.style.transition = 'none';
    overlayProgressBar.style.width = '100%';
    overlayProgressBar.className = 'quiz-progress-bar';

    progressInterval = setInterval(() => {
      const elapsed = Date.now() - startMs;
      const remaining = Math.max(0, 1 - elapsed / totalMs);
      overlayProgressBar.style.width = (remaining * 100) + '%';

      if (remaining > 0.55) {
        overlayProgressBar.className = 'quiz-progress-bar';
      } else if (remaining > 0.25) {
        overlayProgressBar.className = 'quiz-progress-bar bar-warning';
      } else {
        overlayProgressBar.className = 'quiz-progress-bar bar-danger';
      }

      if (remaining <= 0) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    }, updateRate);
  }

  // ============================================
  // Submit Answer
  // ============================================

  function submitAnswer(answerValue, btnElement) {
    if (answered) return;
    answered = true;
    stopTimer();

    const elapsed = Date.now() - roundStartTime;

    if (currentQuestionType === 'choice') {
      // Visual feedback
      if (btnElement) btnElement.classList.add('selected-answer');
      overlayAnswers.querySelectorAll('.quiz-answer-btn').forEach(b => {
        b.style.pointerEvents = 'none';
      });
    } else {
      // Estimate — disable input
      estimateInput.disabled = true;
      estimateSubmitBtn.disabled = true;
      estimateSubmitBtn.textContent = '✅ Odesláno';
    }

    socket.emit('submit-answer', {
      answer: answerValue,
      timestamp: elapsed
    });

    console.log(`📤 Odpověď odeslána: ${answerValue} (čas: ${elapsed}ms)`);
  }

  // Estimate submit handler
  estimateSubmitBtn.addEventListener('click', () => {
    const val = estimateInput.value.trim();
    if (val === '' || isNaN(Number(val))) {
      estimateInput.classList.add('input-error');
      setTimeout(() => estimateInput.classList.remove('input-error'), 600);
      return;
    }
    submitAnswer(Number(val), null);
  });

  estimateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') estimateSubmitBtn.click();
  });

  // ============================================
  // Show result feedback based on question type
  // ============================================

  function showRoundResultFeedback(data) {
    if (data.questionType === 'choice') {
      const buttons = overlayAnswers.querySelectorAll('.quiz-answer-btn');
      buttons.forEach((btn, i) => {
        btn.style.pointerEvents = 'none';
        if (i === data.correctAnswer) {
          btn.classList.add('correct');
        }
      });

      if (answered) {
        const selectedBtn = overlayAnswers.querySelector('.selected-answer');
        if (selectedBtn && parseInt(selectedBtn.dataset.index) !== data.correctAnswer) {
          selectedBtn.classList.add('wrong');
        }
      }
    } else {
      const correctVal = data.correctValue;
      const unit = data.unit || '';
      estimateResult.style.display = 'block';
      estimateResult.innerHTML = `<strong>Správná odpověď:</strong> ${correctVal} ${unit}`;
      if (data.winners && data.winners.length > 0) {
        data.winners.forEach(w => {
          const winnerAnswer = data.answers && data.answers[w.socketId];
          if (winnerAnswer) {
            estimateResult.innerHTML += `<br><strong>${w.name}</strong> tipnul/a: ${winnerAnswer.answer} ${unit}`;
          }
        });
      }
    }
  }

  // ============================================
  // Socket.IO herní eventy — Conquest fáze
  // ============================================

  // Selection phase — hráč vybírá území
  socket.on('selection-phase', (data) => {
    console.log(`📮 Kolo ${data.round}: Výběr území (${data.timeLimit}s)`, data.selectable);

    updateHUD({ phase: 'conquest', round: data.round, turnInfo: '' });

    // Aktualizovat mapu
    updateMapOwnership(data.mapOwnership);
    mySelectedDistrict = null;

    // Zvýraznit volitelné čtvrtě
    data.selectable.forEach(districtId => {
      const el = document.getElementById(districtId);
      if (el) el.classList.add('selectable');
    });

    // Zobrazit selection overlay
    const overlay = document.getElementById('selection-overlay');
    const countdownEl = document.getElementById('selection-countdown');
    const statusEl = document.getElementById('selection-status');
    const roundEl = document.getElementById('selection-round');

    if (roundEl) roundEl.textContent = `Kolo ${data.round}`;
    if (statusEl) statusEl.textContent = 'Klikni na zvýrazněnou čtvrt!';
    if (overlay) overlay.style.display = 'flex';

    // Countdown
    let countdown = data.timeLimit;
    if (countdownEl) countdownEl.textContent = countdown;
    window._selectionTimerInterval = setInterval(() => {
      countdown--;
      if (countdownEl) countdownEl.textContent = Math.max(0, countdown);
      if (countdown <= 0) {
        clearInterval(window._selectionTimerInterval);
        window._selectionTimerInterval = null;
      }
    }, 1000);

    // Aktivovat selection mode
    window._selectionMode = true;
    window._handleDistrictSelection = function (districtId) {
      if (!data.selectable.includes(districtId)) {
        showNotification('Tuto čtvrt nemůžeš vybrat! Musí sousedít s tvým územím.', 'warning');
        return;
      }

      // Odeslat výběr na server
      socket.emit('select-district', { district: districtId }, (res) => {
        if (!res.success) {
          showNotification(res.error, 'warning');
          return;
        }

        mySelectedDistrict = districtId;

        // Vizulní feedback
        document.querySelectorAll('.district.selectable').forEach(d => d.classList.remove('selectable'));
        document.querySelectorAll('.district.selected-by-me').forEach(d => d.classList.remove('selected-by-me'));
        const el = document.getElementById(districtId);
        if (el) el.classList.add('selected-by-me');

        const districtName = el ? el.dataset.name : districtId;
        if (statusEl) statusEl.textContent = `Vybráno: ${districtName} — čekám na ostatní...`;

        console.log(`✅ Vybráno: ${districtId}`);
      });
    };
  });

  // Progress výběru (kolik hráčů již vybralo)
  socket.on('selection-progress', (data) => {
    const statusEl = document.getElementById('selection-status');
    if (statusEl && mySelectedDistrict) {
      statusEl.textContent = `Čekám na ostatní... (${data.chosen}/${data.total})`;
    }
  });

  // Nové kolo — otázka (po výběru území)
  socket.on('new-round', (data) => {
    console.log(`📋 Kolo ${data.round}: Otázka [${data.question.type}]`);

    cleanupSelectionMode();

    // Zvýraznit všechny vybrané čtvrtě na mapě
    highlightDistrictChoices(data.districtChoices, socket.id);

    // Určit district pro quiz overlay tag (můj výběr)
    const myDistrict = data.districtChoices[socket.id] || mySelectedDistrict || Object.values(data.districtChoices)[0] || '';

    setTimeout(() => {
      roundStartTime = Date.now();
      showQuizOverlay(data.question, myDistrict, null);
      startTimer(data.timeLimit);
    }, 1500);
  });

  // Výsledek kola
  socket.on('round-result', (data) => {
    stopTimer();
    showRoundResultFeedback(data);

    updateMapOwnership(data.mapOwnership);
    updateScores(data.scores);
    clearDistrictHighlight();

    // Log výtězů
    if (data.winners && data.winners.length > 0) {
      data.winners.forEach(w => {
        const el = document.getElementById(w.district);
        const name = el ? el.dataset.name : w.district;
        console.log(`🏆 ${w.name} získává ${name}!`);
      });
    } else {
      console.log(`😢 Nikdo nezískal žádné území.`);
    }

    if (!data.gameOver) {
      setTimeout(() => hideQuizOverlay(), 2500);
    }
  });

  // ============================================
  // Socket.IO herní eventy — Attack fáze
  // ============================================

  // Attack fáze zahájena
  socket.on('attack-phase-started', () => {
    isAttackPhase = true;
    console.log('⚔️ Attack fáze zahájena!');
    showNotification('⚔️ Všechny čtvrtě obsazeny — začíná boj o území!', 'warning');
    updateHUD({ phase: 'attack', round: null, turnInfo: '' });
  });

  // Útočník má vybrat cíl
  socket.on('attack-select', (data) => {
    console.log('⚔️ Výběr útoku:', data);
    updateHUD({ turnInfo: `Na tahu: ${data.attackerName}` });

    const isMe = data.attackerSocketId === socket.id;

    if (isMe) {
      // Já jsem útočník — zobrazit overlay a umožnit kliknutí na mapu
      attackSelectAttacker.textContent = `Jsi na řadě, ${data.attackerName}!`;
      attackSelectOverlay.style.display = 'flex';

      // Zvýraznit napadnutelné čtvrtě
      data.attackableDistricts.forEach(d => {
        const el = document.getElementById(d.districtId);
        if (el) el.classList.add('attackable');
      });

      // Attack select countdown
      let countdown = 15;
      attackSelectCountdown.textContent = countdown;
      const countdownInterval = setInterval(() => {
        countdown--;
        attackSelectCountdown.textContent = countdown;
        if (countdown <= 0) clearInterval(countdownInterval);
      }, 1000);

      // Enable click mode
      window._attackSelectMode = true;
      window._attackSelectCountdownInterval = countdownInterval;
      window._handleAttackDistrictClick = function (districtId) {
        // Check if the clicked district is in attackable list
        const attackable = data.attackableDistricts.find(d => d.districtId === districtId);
        if (!attackable) {
          showNotification('Tuto čtvrť nemůžeš napadnout!', 'warning');
          return;
        }

        // Send selection
        socket.emit('select-attack-target', { district: districtId }, (res) => {
          if (!res.success) {
            showNotification(res.error, 'warning');
            return;
          }
          // Clean up
          cleanupAttackSelect();
        });
      };
    } else {
      // Nejsem útočník — jen info
      showNotification(`⚔️ ${data.attackerName} vybírá čtvrť k útoku...`, 'info');
    }
  });

  function cleanupAttackSelect() {
    attackSelectOverlay.style.display = 'none';
    window._attackSelectMode = false;
    if (window._attackSelectCountdownInterval) {
      clearInterval(window._attackSelectCountdownInterval);
    }
    document.querySelectorAll('.district.attackable').forEach(d => {
      d.classList.remove('attackable');
    });
  }

  // Attack kolo (sub-round otázky)
  socket.on('attack-round', (data) => {
    console.log(`⚔️ Attack sub-kolo ${data.subRound}:`, data.attackState);
    cleanupAttackSelect();

    highlightDistrict(data.attackState.district);

    setTimeout(() => {
      roundStartTime = Date.now();
      showQuizOverlay(data.question, data.attackState.district, data.attackState);
      startTimer(data.timeLimit);
    }, 1500);
  });

  // Výsledek attack sub-kola
  socket.on('attack-sub-result', (data) => {
    stopTimer();
    showRoundResultFeedback(data);

    // Aktualizovat battle tracker
    battleAttackerScore.textContent = data.attackScores.attacker;
    battleDefenderScore.textContent = data.attackScores.defender;

    if (data.subWinner === 'attacker') {
      battleAttackerScore.classList.add('score-flash');
      setTimeout(() => battleAttackerScore.classList.remove('score-flash'), 600);
    } else if (data.subWinner === 'defender') {
      battleDefenderScore.classList.add('score-flash');
      setTimeout(() => battleDefenderScore.classList.remove('score-flash'), 600);
    }

    updateMapOwnership(data.mapOwnership);
    updateScores(data.scores);
    clearDistrictHighlight();

    if (data.battleOver) {
      // Zobrazit výsledek bitvy
      setTimeout(() => {
        hideQuizOverlay().then(() => {
          showAttackResult(data);
        });
      }, 2000);
    } else {
      // Pokračovat dalším sub-kolem
      if (!data.gameOver) {
        setTimeout(() => hideQuizOverlay(), 2500);
      }
    }
  });

  function showAttackResult(data) {
    const districtEl = document.getElementById(data.district);
    const districtName = districtEl ? districtEl.dataset.name : data.district;

    if (data.battleWinner === 'attacker') {
      attackResultTitle.textContent = `⚔️ ${data.attackerName} dobývá ${districtName}!`;
      attackResultDetail.textContent = `Výsledek: ${data.attackScores.attacker}–${data.attackScores.defender}`;
      attackResultOverlay.className = 'attack-result-overlay result-attacker-won';
    } else {
      attackResultTitle.textContent = `🛡️ ${data.defenderName} ubránil/a ${districtName}!`;
      attackResultDetail.textContent = `Výsledek: ${data.attackScores.defender}–${data.attackScores.attacker} pro obránce`;
      attackResultOverlay.className = 'attack-result-overlay result-defender-won';
    }

    attackResultOverlay.style.display = 'flex';

    setTimeout(() => {
      attackResultOverlay.style.display = 'none';
    }, 3000);
  }

  // ============================================
  // Game Over
  // ============================================

  socket.on('game-over', (data) => {
    console.log('🎉 Konec hry!', data.scores, 'důvod:', data.reason);
    stopTimer();
    cleanupAttackSelect();

    hideQuizOverlay().then(() => {
      updateMapOwnership(data.mapOwnership);
      updateScores(data.scores);
      clearDistrictHighlight();

      const sorted = [...data.scores]
        .map((s, i) => ({ ...s, originalIndex: i }))
        .sort((a, b) => b.score - a.score);

      const reasonEl = document.getElementById('gameover-reason');
      const TOTAL_DISTRICTS = 15;
      switch (data.reason) {
        case 'dominance':
          reasonEl.textContent = `${sorted[0].name} ovládl/a 70 % mapy!`;
          break;
        case 'no-questions':
          reasonEl.textContent = 'Došly všechny otázky!';
          break;
        case 'all-districts':
          reasonEl.textContent = 'Všechny čtvrtě jsou obsazeny!';
          break;
        default:
          reasonEl.textContent = 'Hra skončila!';
      }

      const podium = document.getElementById('gameover-podium');
      const medals = ['🥇', '🥈', '🥉'];
      const placeLabels = ['1. místo', '2. místo', '3. místo'];
      podium.innerHTML = '';

      sorted.forEach((player, i) => {
        const place = document.createElement('div');
        place.className = `podium-place podium-${i + 1}`;
        place.style.animationDelay = `${0.3 + i * 0.15}s`;
        place.innerHTML = `
          <span class="podium-medal">${medals[i] || `${i + 1}.`}</span>
          <span class="podium-label">${placeLabels[i] || `${i + 1}. místo`}</span>
          <span class="podium-name">${player.name}</span>
          <span class="podium-score">${player.score} / ${TOTAL_DISTRICTS} čtvrtí</span>
          <div class="podium-bar" style="--bar-height: ${Math.max(20, (player.score / TOTAL_DISTRICTS) * 100)}%;">
            <div class="podium-bar-inner" style="background: ${PLAYER_COLORS[player.originalIndex] || '#888'};"></div>
          </div>
        `;
        podium.appendChild(place);
      });

      document.getElementById('gameover-overlay').style.display = 'flex';
      document.getElementById('btn-back-lobby').onclick = () => window.location.reload();

      // Restart button handler
      const btnPlayAgain = document.getElementById('btn-play-again');
      if (btnPlayAgain) {
        btnPlayAgain.disabled = false;
        btnPlayAgain.textContent = '🔄 Hrát znovu';
        btnPlayAgain.onclick = () => {
          btnPlayAgain.disabled = true;
          btnPlayAgain.textContent = '⏳ Restartuji...';
          socket.emit('restart-game', (res) => {
            if (!res.success) {
              showNotification(res.error, 'warning');
              btnPlayAgain.disabled = false;
              btnPlayAgain.textContent = '🔄 Hrát znovu';
            }
          });
        };
      }
    });
  });

  // Restart hry — server potvrdil restart, resetujeme klientský stav
  socket.on('game-restarted', (data) => {
    console.log('🔄 Hra restartována!', data.players);

    // Skrýt všechny overlays
    document.getElementById('gameover-overlay').style.display = 'none';
    quizOverlay.style.display = 'none';
    quizOverlay.classList.remove('quiz-overlay-hiding');
    attackResultOverlay.style.display = 'none';

    // Reset herního stavu
    isAttackPhase = false;
    mySelectedDistrict = null;
    answered = false;
    stopTimer();
    cleanupSelectionMode();
    cleanupAttackSelect();

    // Reset mapy a scoreboardu
    updateMapOwnership({});
    clearDistrictHighlight();
    if (typeof window.initGameScoreboard === 'function') {
      window.initGameScoreboard(data.players);
    }

    // Reset HUD
    updateHUD({ phase: 'conquest', round: '—', turnInfo: '' });

    showNotification('🔄 Nová hra začíná!', 'info');
  });

  // Hráč se odpojil během hry
  socket.on('player-disconnected', (data) => {
    console.log(`⚠️ ${data.playerName} se odpojil`);
    showNotification(`Hráč ${data.playerName} se odpojil`, 'warning');

    const list = document.getElementById('game-scoreboard-list');
    if (list) {
      list.querySelectorAll('.scoreboard-item').forEach(item => {
        const nameEl = item.querySelector('.player-name');
        if (nameEl && nameEl.textContent === data.playerName) {
          item.classList.add('player-disconnected');
          nameEl.textContent = `${data.playerName} (odpojen)`;
        }
      });
    }
  });

  // --- Notifikační toast ---
  function showNotification(message, type = 'info') {
    const container = document.getElementById('game-notifications');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `game-toast game-toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'warning' ? '⚠️' : 'ℹ️'}</span>
      <span class="toast-text">${message}</span>
    `;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  window.showNotification = showNotification;
})();

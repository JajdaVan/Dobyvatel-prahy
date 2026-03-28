// Správa Socket.io eventů – lobby + herní logika + attack fáze
const GameManager = require('./game/GameManager');
const questions = require('./data/questions.json');

const gameManager = new GameManager();
const ROUND_TIME = 15000; // 15 sekund na odpověď

module.exports = function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log(`Hráč připojen: ${socket.id}`);

    // ============================
    // LOBBY: Vytvořit místnost
    // ============================
    socket.on('create-room', (playerName, callback) => {
      const name = (playerName || 'Hráč').trim().substring(0, 20);
      const room = gameManager.createRoom(socket.id, name);
      socket.join(room.code);
      console.log(`🏠 Místnost ${room.code} vytvořena hráčem ${name}`);

      callback({
        success: true,
        code: room.code,
        players: room.players.map(p => ({ name: p.name, score: p.score, isHost: p.id === room.host }))
      });
    });

    // ============================
    // LOBBY: Připojit se
    // ============================
    socket.on('join-room', (data, callback) => {
      const code = (data.code || '').trim().toUpperCase();
      const name = (data.playerName || 'Hráč').trim().substring(0, 20);
      const result = gameManager.joinRoom(code, socket.id, name);

      if (!result.success) {
        callback({ success: false, error: result.error });
        return;
      }

      socket.join(code);
      console.log(`🚪 ${name} se připojil do místnosti ${code}`);

      const playerList = result.room.players.map(p => ({
        name: p.name, score: p.score, isHost: p.id === result.room.host
      }));

      callback({ success: true, code, players: playerList });
      socket.to(code).emit('player-joined', { players: playerList, newPlayer: name });
    });

    // ============================
    // HRA: Hostitel spouští hru
    // ============================
    socket.on('start-game', (callback) => {
      const found = gameManager.findRoomByPlayer(socket.id);
      if (!found) return callback({ success: false, error: 'Nejsi v žádné místnosti.' });

      const { code, room } = found;
      if (room.host !== socket.id) return callback({ success: false, error: 'Pouze hostitel může spustit hru.' });
      if (room.state !== 'waiting') return callback({ success: false, error: 'Hra už běží.' });

      // Inicializace hry
      gameManager.startGame(code, questions);
      console.log(`🎮 Hra zahájena v místnosti ${code}`);

      // Oznámit všem hráčům
      const playerInfo = room.players.map((p, i) => ({
        name: p.name, score: 0, playerIndex: i
      }));
      io.to(code).emit('game-started', { players: playerInfo });

      callback({ success: true });

      // Spustit první kolo (s krátkým zpožděním pro animaci)
      setTimeout(() => startNextRound(code), 1500);
    });

    // ============================
    // HRA: Hráč odevzdá odpověď (conquest)
    // ============================
    socket.on('submit-answer', (data) => {
      const found = gameManager.findRoomByPlayer(socket.id);
      if (!found) return;

      const { code } = found;
      const room = gameManager.getRoom(code);

      // Router: conquest vs attack
      if (room && room.phase === 'attack' && room.attackState) {
        const result = gameManager.submitAttackAnswer(code, socket.id, data.answer, data.timestamp);
        if (result.success && result.allAnswered) {
          if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
          finishAttackSubRound(code);
        }
      } else {
        const result = gameManager.submitAnswer(code, socket.id, data.answer, data.timestamp);
        if (result.success && result.allAnswered) {
          if (room && room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
          finishRound(code);
        }
      }
    });

    // ============================
    // ATTACK: Hráč vybere čtvrť k útoku
    // ============================
    socket.on('select-attack-target', (data, callback) => {
      const found = gameManager.findRoomByPlayer(socket.id);
      if (!found) return callback({ success: false, error: 'Nejsi v místnosti.' });

      const { code } = found;
      const result = gameManager.startAttack(code, socket.id, data.district);

      if (!result.success) {
        return callback({ success: false, error: result.error });
      }

      callback({ success: true });
      console.log(`⚔️ ${socket.id} útočí na ${data.district} v ${code}`);

      // Zahájit první sub-kolo attack
      setTimeout(() => startAttackSubRound(code), 1000);
    });

    // ============================
    // Odpojení hráče
    // ============================
    socket.on('disconnect', () => {
      console.log(`Hráč odpojen: ${socket.id}`);
      const result = gameManager.removePlayer(socket.id);
      if (result) {
        if (result.dissolved) {
          console.log(`🗑️ Místnost ${result.code} rozpuštěna (prázdná)`);
        } else if (result.midGame) {
          console.log(`⚠️ ${result.playerName} se odpojil během hry v ${result.code}`);
          io.to(result.code).emit('player-disconnected', { playerName: result.playerName });

          // Zkontroluj, jestli všichni aktivní hráči už odpověděli
          const room = result.room;
          if (room.phase === 'attack' && room.attackState && room.currentQuestion) {
            // V attack fázi — zkontroluj jestli oba combatants odpověděli
            const atk = room.attackState;
            const attackerId = room.players[atk.attackerIndex].id;
            const defenderId = room.players[atk.defenderIndex].id;
            const atkDone = room.roundAnswers[attackerId] || room.players[atk.attackerIndex].disconnected;
            const defDone = room.roundAnswers[defenderId] || room.players[atk.defenderIndex].disconnected;
            if (atkDone && defDone) {
              if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
              finishAttackSubRound(result.code);
            }
          } else if (room.currentQuestion) {
            const activePlayers = gameManager.getActivePlayers(room);
            const answeredCount = Object.keys(room.roundAnswers).length;
            if (answeredCount >= activePlayers.length) {
              if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
              finishRound(result.code);
            }
          }
        } else {
          // Odpojení v lobby
          const playerList = result.room.players.map(p => ({
            name: p.name, score: p.score, isHost: p.id === result.room.host
          }));
          io.to(result.code).emit('player-left', { players: playerList });
          console.log(`👋 Hráč odešel z místnosti ${result.code}, zbývá ${result.room.players.length}`);
        }
      }
    });
  });

  // ============================
  // Conquest fáze
  // ============================

  function startNextRound(code) {
    const roundData = gameManager.startRound(code);
    const room = gameManager.getRoom(code);

    if (!roundData) {
      if (!room) return;

      // Přepnutí do attack fáze
      if (room.phase === 'attack') {
        console.log(`⚔️ Attack fáze zahájena v ${code}`);
        startAttackPhase(code);
        return;
      }

      // Konec hry — došly otázky nebo jiný důvod
      room.state = 'finished';
      const reason = gameManager._remainingQuestions(room) === 0 ? 'no-questions' : 'all-districts';
      io.to(code).emit('game-over', {
        reason,
        scores: room.players.map(p => ({ name: p.name, score: p.score })),
        mapOwnership: room.mapOwnership
      });
      return;
    }

    console.log(`📋 Kolo ${roundData.round} v ${code}: ${roundData.district} [${roundData.question.type}]`);

    // Poslat otázku všem hráčům
    io.to(code).emit('new-round', {
      round: roundData.round,
      district: roundData.district,
      question: roundData.question,
      timeLimit: ROUND_TIME / 1000
    });

    // Časovač – po 15s automaticky vyhodnotit
    if (room) {
      room.roundTimer = setTimeout(() => {
        finishRound(code);
      }, ROUND_TIME + 500);
    }
  }

  function finishRound(code) {
    const result = gameManager.evaluateRound(code);
    if (!result) return;

    console.log(`✅ Kolo vyhodnoceno v ${code}: vítěz = ${result.winner ? result.winner.name : 'nikdo'} [${result.questionType}]`);

    // Poslat výsledek kola všem
    io.to(code).emit('round-result', {
      correctAnswer: result.correctAnswer,
      correctValue: result.correctValue,
      questionType: result.questionType,
      unit: result.unit,
      winner: result.winner,
      district: result.district,
      mapOwnership: result.mapOwnership,
      scores: result.scores,
      answers: result.answers,
      gameOver: result.gameOver
    });

    if (result.gameOver) {
      io.to(code).emit('game-over', {
        reason: result.gameOverReason,
        scores: result.scores,
        mapOwnership: result.mapOwnership
      });
    } else if (result.switchToAttack) {
      // Přepnout do attack fáze po zobrazení výsledku
      setTimeout(() => startAttackPhase(code), 3000);
    } else {
      setTimeout(() => startNextRound(code), 3000);
    }
  }

  // ============================
  // Attack fáze
  // ============================

  function startAttackPhase(code) {
    const room = gameManager.getRoom(code);
    if (!room || room.state !== 'playing') return;

    // Zkontroluj jestli je dost otázek
    if (gameManager._remainingQuestions(room) === 0) {
      room.state = 'finished';
      io.to(code).emit('game-over', {
        reason: 'no-questions',
        scores: room.players.map(p => ({ name: p.name, score: p.score })),
        mapOwnership: room.mapOwnership
      });
      return;
    }

    // Oznámit všem, že začíná attack fáze
    io.to(code).emit('attack-phase-started');

    // Kdo útočí?
    promptAttacker(code);
  }

  function promptAttacker(code) {
    const room = gameManager.getRoom(code);
    if (!room || room.state !== 'playing' || room.phase !== 'attack') return;

    if (gameManager._remainingQuestions(room) === 0) {
      room.state = 'finished';
      io.to(code).emit('game-over', {
        reason: 'no-questions',
        scores: room.players.map(p => ({ name: p.name, score: p.score })),
        mapOwnership: room.mapOwnership
      });
      return;
    }

    const attackerInfo = gameManager.getAttacker(room);
    if (!attackerInfo) return;

    const attackable = gameManager.getAttackableDistricts(room, attackerInfo.playerIndex);

    if (attackable.length === 0) {
      // Tento hráč nemá co napadnout (nemůže útočit sám na sebe) — přeskoč
      room.attackTurnIndex++;
      promptAttacker(code);
      return;
    }

    // Pošli útočníkovi výzvu
    io.to(code).emit('attack-select', {
      attackerSocketId: attackerInfo.player.id,
      attackerName: attackerInfo.player.name,
      attackerIndex: attackerInfo.playerIndex,
      attackableDistricts: attackable
    });

    // Auto-timeout — pokud hráč nevybere do 15s, vybereme za něj náhodně
    room.roundTimer = setTimeout(() => {
      if (room.attackState) return; // už vybral
      const randomTarget = attackable[Math.floor(Math.random() * attackable.length)];
      gameManager.startAttack(code, attackerInfo.player.id, randomTarget.districtId);
      console.log(`⏱️ Auto-výběr útoku: ${randomTarget.districtId} v ${code}`);
      startAttackSubRound(code);
    }, 15000);
  }

  function startAttackSubRound(code) {
    const room = gameManager.getRoom(code);
    if (!room) return;

    const subRoundData = gameManager.startAttackSubRound(code);
    if (!subRoundData) {
      // Došly otázky
      room.state = 'finished';
      io.to(code).emit('game-over', {
        reason: 'no-questions',
        scores: room.players.map(p => ({ name: p.name, score: p.score })),
        mapOwnership: room.mapOwnership
      });
      return;
    }

    console.log(`⚔️ Attack sub-kolo ${subRoundData.subRound} v ${code}: ${subRoundData.attackState.attackerName} vs ${subRoundData.attackState.defenderName}`);

    io.to(code).emit('attack-round', {
      subRound: subRoundData.subRound,
      question: subRoundData.question,
      attackState: subRoundData.attackState,
      timeLimit: ROUND_TIME / 1000
    });

    room.roundTimer = setTimeout(() => {
      finishAttackSubRound(code);
    }, ROUND_TIME + 500);
  }

  function finishAttackSubRound(code) {
    const result = gameManager.evaluateAttackSubRound(code);
    if (!result) return;

    console.log(`⚔️ Sub-kolo výsledek: ${result.subWinner || 'remíza'} | ${result.attackScores.attacker}-${result.attackScores.defender}`);

    io.to(code).emit('attack-sub-result', {
      correctAnswer: result.correctAnswer,
      correctValue: result.correctValue,
      questionType: result.questionType,
      unit: result.unit,
      subWinner: result.subWinner,
      attackScores: result.attackScores,
      battleOver: result.battleOver,
      battleWinner: result.battleWinner,
      district: result.district,
      attackerName: result.attackerName,
      defenderName: result.defenderName,
      mapOwnership: result.mapOwnership,
      scores: result.scores,
      answers: result.answers,
      gameOver: result.gameOver
    });

    if (result.gameOver) {
      io.to(code).emit('game-over', {
        reason: result.gameOverReason,
        scores: result.scores,
        mapOwnership: result.mapOwnership
      });
    } else if (result.battleOver) {
      // Bitva skončila — další útočník
      setTimeout(() => promptAttacker(code), 3000);
    } else {
      // Další sub-kolo
      setTimeout(() => startAttackSubRound(code), 2500);
    }
  }
};

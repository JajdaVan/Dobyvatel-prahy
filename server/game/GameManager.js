// Správa herních lobby a herní logiky

const DISTRICTS = [
  'praha-1', 'praha-2', 'praha-3', 'praha-4', 'praha-5',
  'praha-6', 'praha-7', 'praha-8', 'praha-9', 'praha-10',
  'praha-11', 'praha-12', 'praha-13', 'praha-14', 'praha-15'
];

// Mapa sousedství čtvrtí (na základě SVG mapy)
const ADJACENCY_MAP = {
  'praha-1':  ['praha-2', 'praha-5', 'praha-7', 'praha-8'],
  'praha-2':  ['praha-1', 'praha-3', 'praha-4', 'praha-10'],
  'praha-3':  ['praha-2', 'praha-8', 'praha-9', 'praha-10'],
  'praha-4':  ['praha-1', 'praha-2', 'praha-5', 'praha-11', 'praha-12'],
  'praha-5':  ['praha-1', 'praha-4', 'praha-6', 'praha-12', 'praha-13'],
  'praha-6':  ['praha-5', 'praha-7', 'praha-13'],
  'praha-7':  ['praha-1', 'praha-6', 'praha-8'],
  'praha-8':  ['praha-1', 'praha-3', 'praha-7', 'praha-9'],
  'praha-9':  ['praha-3', 'praha-8', 'praha-10', 'praha-14'],
  'praha-10': ['praha-2', 'praha-3', 'praha-9', 'praha-11', 'praha-14', 'praha-15'],
  'praha-11': ['praha-4', 'praha-10', 'praha-12', 'praha-15'],
  'praha-12': ['praha-4', 'praha-5', 'praha-11'],
  'praha-13': ['praha-5', 'praha-6'],
  'praha-14': ['praha-9', 'praha-10', 'praha-15'],
  'praha-15': ['praha-10', 'praha-11', 'praha-14']
};

const WIN_THRESHOLD = 0.7; // 70 % mapy = vítězství
const WIN_DISTRICT_COUNT = Math.ceil(DISTRICTS.length * WIN_THRESHOLD); // 11 z 15
const ESTIMATE_CHANCE = 0.25; // 25 % šance na odhadovací otázku
const ESTIMATE_TOLERANCE = 0.05; // 5 % povolená odchylka u estimate otázek
const ESTIMATE_MIN_TOLERANCE = 1;  // Minimální absolutní odchylka (pro malá čísla jako 5, 6, 8)
const ESTIMATE_MAX_TOLERANCE = 25; // Maximální absolutní odchylka (pro velká čísla jako letopočty)

class GameManager {
  constructor() {
    this.rooms = new Map();
  }

  // Generování unikátního 4-místného kódu (A-Z)
  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  // Vytvořit novou místnost
  createRoom(hostSocketId, playerName) {
    const code = this.generateCode();
    const room = {
      code,
      host: hostSocketId,
      players: [
        { id: hostSocketId, name: playerName, score: 0 }
      ],
      maxPlayers: 3,
      state: 'waiting', // waiting | playing | finished

      // --- Herní stav ---
      phase: 'conquest',              // conquest | attack
      roundPhase: 'idle',             // idle | selecting | answering
      mapOwnership: {},               // { 'praha-1': playerIndex, ... }
      availableDistricts: [],          // čtvrtě, které ještě nikdo nevlastní
      currentRound: 0,
      currentQuestion: null,
      districtChoices: {},             // { socketId: districtId } — výběry hráčů
      roundAnswers: {},                // { socketId: { answer, time } }
      roundTimer: null,
      selectionTimer: null,
      choicePool: [],                  // choice otázky (shuffled)
      estimatePool: [],                // estimate otázky (shuffled)
      choiceIndex: 0,
      estimateIndex: 0,

      // --- Attack stav ---
      attackState: null,               // { attackerIndex, defenderIndex, district, scores: {attacker: 0, defender: 0}, subRound: 0 }
      attackTurnIndex: 0,              // kdo je na řadě s útokem (rotuje)
      attackRoundsPlayed: 0            // kolik útoků proběhlo
    };
    this.rooms.set(code, room);
    return room;
  }

  // Připojit hráče do místnosti
  joinRoom(code, socketId, playerName) {
    const room = this.rooms.get(code);
    if (!room) return { success: false, error: 'Místnost neexistuje.' };
    if (room.state !== 'waiting') return { success: false, error: 'Hra již probíhá.' };
    if (room.players.length >= room.maxPlayers) return { success: false, error: 'Místnost je plná (max 3 hráči).' };
    if (room.players.some(p => p.id === socketId)) return { success: false, error: 'Už jsi v této místnosti.' };

    room.players.push({ id: socketId, name: playerName, score: 0 });
    return { success: true, room };
  }

  // Odpojit hráče
  removePlayer(socketId) {
    for (const [code, room] of this.rooms) {
      const idx = room.players.findIndex(p => p.id === socketId);
      if (idx !== -1) {
        const playerName = room.players[idx].name;

        // Pokud hra probíhá, neodstraňuj hráče – jen ho označ jako odpojeného
        if (room.state === 'playing') {
          room.players[idx].disconnected = true;

          // Zkontroluj, jestli zbývá alespoň 1 aktivní hráč
          const activePlayers = this.getActivePlayers(room);
          if (activePlayers.length === 0) {
            if (room.roundTimer) clearTimeout(room.roundTimer);
            this.rooms.delete(code);
            return { code, room: null, dissolved: true, playerName };
          }

          // Pokud host odešel, předej hostitele dalšímu aktivnímu hráči
          if (room.host === socketId) {
            room.host = activePlayers[0].id;
          }

          return { code, room, dissolved: false, midGame: true, playerName };
        }

        // V lobby – odstraň hráče normálně
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          if (room.roundTimer) clearTimeout(room.roundTimer);
          this.rooms.delete(code);
          return { code, room: null, dissolved: true, playerName };
        }
        if (room.host === socketId) {
          room.host = room.players[0].id;
        }
        return { code, room, dissolved: false, midGame: false, playerName };
      }
    }
    return null;
  }

  // Vrátit aktivní (nepřipojené) hráče
  getActivePlayers(room) {
    return room.players.filter(p => !p.disconnected);
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  findRoomByPlayer(socketId) {
    for (const [code, room] of this.rooms) {
      if (room.players.some(p => p.id === socketId)) {
        return { code, room };
      }
    }
    return null;
  }

  // ============================================
  // Herní logika
  // ============================================

  // Inicializace hry (po kliknutí na Start)
  startGame(code, questions) {
    const room = this.rooms.get(code);
    if (!room) return null;

    room.state = 'playing';
    room.phase = 'conquest';
    room.currentRound = 0;
    room.mapOwnership = {};
    room.availableDistricts = [...DISTRICTS];

    // Rozdělit otázky do dvou poolů
    room.choicePool = this._shuffle(questions.filter(q => q.type === 'choice'));
    room.estimatePool = this._shuffle(questions.filter(q => q.type === 'estimate'));
    room.choiceIndex = 0;
    room.estimateIndex = 0;

    room.attackState = null;
    room.attackTurnIndex = 0;
    room.attackRoundsPlayed = 0;

    // Reset hráčských skóre a herního stavu (důležité pro restart)
    room.players.forEach(p => { p.score = 0; });
    room.districtChoices = {};
    room.roundAnswers = {};
    room.currentQuestion = null;
    room.roundPhase = 'idle';

    return room;
  }

  // Vybrat otázku — 25% šance na estimate, zbytek choice
  _pickQuestion(room) {
    const rollEstimate = Math.random() < ESTIMATE_CHANCE;
    const hasEstimate = room.estimateIndex < room.estimatePool.length;
    const hasChoice = room.choiceIndex < room.choicePool.length;

    if (!hasChoice && !hasEstimate) return null; // došly otázky

    if (rollEstimate && hasEstimate) {
      return room.estimatePool[room.estimateIndex++];
    } else if (hasChoice) {
      return room.choicePool[room.choiceIndex++];
    } else if (hasEstimate) {
      return room.estimatePool[room.estimateIndex++];
    }
    return null;
  }

  // Celkový počet zbývajících otázek
  _remainingQuestions(room) {
    return (room.choicePool.length - room.choiceIndex) + (room.estimatePool.length - room.estimateIndex);
  }

  // ============================================
  // Conquest fáze — Výběr území + otázka
  // ============================================

  // Získat volitelné čtvrtě pro hráče (sousedící s jeho územím)
  getSelectableDistricts(room, playerIndex) {
    const owned = [];
    for (const [districtId, ownerIdx] of Object.entries(room.mapOwnership)) {
      if (ownerIdx === playerIndex) owned.push(districtId);
    }

    // 1. kolo nebo hráč nemá žádné území → libovolná volná čtvrť
    if (owned.length === 0) {
      return [...room.availableDistricts];
    }

    // Najdi sousední volné čtvrtě
    const adjacentFree = new Set();
    for (const ownedDistrict of owned) {
      const neighbors = ADJACENCY_MAP[ownedDistrict] || [];
      for (const neighbor of neighbors) {
        if (room.availableDistricts.includes(neighbor)) {
          adjacentFree.add(neighbor);
        }
      }
    }

    // Pokud žádná sousední volná čtvrť — fallback na libovolnou volnou
    if (adjacentFree.size === 0) {
      return [...room.availableDistricts];
    }

    return [...adjacentFree];
  }

  // Zahájit selection fázi (hráči vybírají území)
  startSelectionPhase(code) {
    const room = this.rooms.get(code);
    if (!room || room.state !== 'playing') return null;

    // Přepnutí do attack fáze pokud nejsou volné čtvrtě
    if (room.availableDistricts.length === 0) {
      room.phase = 'attack';
      return null;
    }

    // Došly otázky → konec hry
    if (this._remainingQuestions(room) === 0) {
      return null;
    }

    room.currentRound++;
    room.roundPhase = 'selecting';
    room.districtChoices = {};
    room.roundAnswers = {};

    // Připravit seznam volitelných čtvrtí pro každého aktivního hráče
    const activePlayers = this.getActivePlayers(room);
    const selectablePerPlayer = {};
    for (const player of activePlayers) {
      const playerIndex = room.players.indexOf(player);
      selectablePerPlayer[player.id] = this.getSelectableDistricts(room, playerIndex);
    }

    return {
      round: room.currentRound,
      selectablePerPlayer
    };
  }

  // Hráč vybere čtvrť
  submitDistrictChoice(code, socketId, districtId) {
    const room = this.rooms.get(code);
    if (!room || room.roundPhase !== 'selecting') {
      return { success: false, error: 'Není fáze výběru.' };
    }

    const playerIndex = room.players.findIndex(p => p.id === socketId);
    if (playerIndex === -1) return { success: false, error: 'Hráč neexistuje.' };

    // Ověř, že čtvrť je volná
    if (!room.availableDistricts.includes(districtId)) {
      return { success: false, error: 'Čtvrť není volná.' };
    }

    // Ověř sousedství
    const selectable = this.getSelectableDistricts(room, playerIndex);
    if (!selectable.includes(districtId)) {
      return { success: false, error: 'Čtvrť nesousedí s tvým územím.' };
    }

    room.districtChoices[socketId] = districtId;

    // Kontrola: vybrali všichni aktivní hráči?
    const activePlayers = this.getActivePlayers(room);
    const allChosen = activePlayers.every(p => room.districtChoices[p.id]);

    return { success: true, allChosen };
  }

  // Auto-přiřadit čtvrť hráčům, kteří si nevybrali (náhodně z volitelných)
  autoAssignMissingChoices(code) {
    const room = this.rooms.get(code);
    if (!room) return;

    const activePlayers = this.getActivePlayers(room);
    for (const player of activePlayers) {
      if (!room.districtChoices[player.id]) {
        const playerIndex = room.players.indexOf(player);
        const selectable = this.getSelectableDistricts(room, playerIndex);
        if (selectable.length > 0) {
          const randomIdx = Math.floor(Math.random() * selectable.length);
          room.districtChoices[player.id] = selectable[randomIdx];
        }
      }
    }
  }

  // Zahájit otázkovou fázi (po výběru území)
  startQuestionPhase(code) {
    const room = this.rooms.get(code);
    if (!room) return null;

    room.roundPhase = 'answering';
    room.roundAnswers = {};

    // Vyber otázku
    room.currentQuestion = this._pickQuestion(room);
    if (!room.currentQuestion) return null;

    const q = room.currentQuestion;
    const questionData = {
      id: q.id,
      question: q.question,
      type: q.type
    };

    if (q.type === 'choice') {
      questionData.options = q.options;
    } else {
      questionData.unit = q.unit || '';
    }

    return {
      round: room.currentRound,
      question: questionData,
      // Pošleme výběry všech hráčů (zobrazí se na mapě)
      districtChoices: { ...room.districtChoices }
    };
  }

  // Zpracovat odpověď hráče
  submitAnswer(code, socketId, answerValue, timestamp) {
    const room = this.rooms.get(code);
    if (!room || room.state !== 'playing') return { success: false };
    if (!room.currentQuestion) return { success: false };

    if (room.roundAnswers[socketId]) return { success: false, error: 'Už jsi odpověděl.' };

    const q = room.currentQuestion;

    if (q.type === 'choice') {
      room.roundAnswers[socketId] = {
        answer: answerValue,
        time: timestamp,
        correct: answerValue === q.correct
      };
    } else {
      room.roundAnswers[socketId] = {
        answer: Number(answerValue),
        time: timestamp,
        diff: Math.abs(Number(answerValue) - q.correct)
      };
    }

    const activePlayers = this.getActivePlayers(room);
    const activeIds = new Set(activePlayers.map(p => p.id));
    const answeredActive = Object.keys(room.roundAnswers).filter(id => activeIds.has(id)).length;
    return { success: true, allAnswered: answeredActive >= activePlayers.length };
  }

  // Vyhodnotit kolo — každý hráč může získat svou zvolenou čtvrť
  evaluateRound(code) {
    const room = this.rooms.get(code);
    if (!room) return null;

    const q = room.currentQuestion;
    const winners = [];     // [ { socketId, playerIndex, name, district } ]
    const losers = [];      // [ { socketId, playerIndex, name, district } ]

    // Seskupit hráče podle zvolené čtvrtě (detekce konfliktů)
    const districtContestants = {}; // { districtId: [ { socketId, playerIndex, answerData } ] }
    for (const [socketId, districtId] of Object.entries(room.districtChoices)) {
      if (!districtContestants[districtId]) districtContestants[districtId] = [];
      const playerIndex = room.players.findIndex(p => p.id === socketId);
      const answerData = room.roundAnswers[socketId] || null;
      districtContestants[districtId].push({ socketId, playerIndex, answerData });
    }

    // Vyhodnotit každou čtvrť
    for (const [districtId, contestants] of Object.entries(districtContestants)) {
      // Najít všechny, kdo odpověděli správně
      let correctContestants = [];

      if (q.type === 'choice') {
        correctContestants = contestants.filter(c => c.answerData && c.answerData.correct);
      } else {
        // Estimate — jen hráči s odchylkou v toleranci od správné hodnoty
        const tolerance = this._estimateTolerance(q.correct);
        correctContestants = contestants.filter(c => c.answerData && c.answerData.diff <= tolerance);
      }

      if (correctContestants.length === 0) {
        // Nikdo neodpověděl správně — nikdo nezíská tuto čtvrť
        contestants.forEach(c => {
          losers.push({
            socketId: c.socketId,
            playerIndex: c.playerIndex,
            name: room.players[c.playerIndex].name,
            district: districtId
          });
        });
        continue;
      }

      // Vybrat vítěze: pokud je jen 1 správný, je vítěz.
      // Pokud je víc (konflikt) → nejrychlejší / nejbližší odhad.
      let winnerC;
      if (q.type === 'choice') {
        correctContestants.sort((a, b) => a.answerData.time - b.answerData.time);
        winnerC = correctContestants[0];
      } else {
        correctContestants.sort((a, b) => {
          if (a.answerData.diff !== b.answerData.diff) return a.answerData.diff - b.answerData.diff;
          return a.answerData.time - b.answerData.time;
        });
        winnerC = correctContestants[0];
      }

      // Přiřadit čtvrť vítězi
      room.mapOwnership[districtId] = winnerC.playerIndex;
      room.players[winnerC.playerIndex].score++;
      room.availableDistricts = room.availableDistricts.filter(d => d !== districtId);

      winners.push({
        socketId: winnerC.socketId,
        playerIndex: winnerC.playerIndex,
        name: room.players[winnerC.playerIndex].name,
        district: districtId
      });

      // Ostatní soutěžící o tutéž čtvrť jsou losers
      contestants.filter(c => c.socketId !== winnerC.socketId).forEach(c => {
        losers.push({
          socketId: c.socketId,
          playerIndex: c.playerIndex,
          name: room.players[c.playerIndex].name,
          district: districtId
        });
      });
    }

    // --- Podmínky konce hry ---
    let gameOver = false;
    let gameOverReason = null;

    for (const p of room.players) {
      if (p.score >= WIN_DISTRICT_COUNT) {
        gameOver = true;
        gameOverReason = 'dominance';
        break;
      }
    }

    if (!gameOver && this._remainingQuestions(room) === 0 && room.availableDistricts.length > 0) {
      gameOver = true;
      gameOverReason = 'no-questions';
    }

    if (gameOver) {
      room.state = 'finished';
    }

    // Reset kola
    room.currentQuestion = null;
    room.roundPhase = 'idle';

    return {
      correctAnswer: q.type === 'choice' ? q.correct : null,
      correctValue: q.type === 'estimate' ? q.correct : null,
      questionType: q.type,
      unit: q.unit || null,
      winners,
      losers,
      districtChoices: { ...room.districtChoices },
      mapOwnership: { ...room.mapOwnership },
      scores: room.players.map(p => ({ name: p.name, score: p.score })),
      answers: room.roundAnswers,
      gameOver,
      gameOverReason,
      switchToAttack: !gameOver && room.availableDistricts.length === 0
    };
  }

  // ============================================
  // Attack fáze — Best of 3
  // ============================================

  // Získat hráče, který je na řadě s útokem
  getAttacker(room) {
    const active = this.getActivePlayers(room);
    if (active.length === 0) return null;
    const idx = room.attackTurnIndex % active.length;
    return { player: active[idx], playerIndex: room.players.indexOf(active[idx]) };
  }

  // Získat čtvrtě, které může hráč napadnout (patří jiným hráčům)
  getAttackableDistricts(room, attackerPlayerIndex) {
    const result = [];
    for (const [districtId, ownerIndex] of Object.entries(room.mapOwnership)) {
      if (ownerIndex !== attackerPlayerIndex) {
        const owner = room.players[ownerIndex];
        result.push({
          districtId,
          ownerIndex,
          ownerName: owner ? owner.name : 'Neznámý'
        });
      }
    }
    return result;
  }

  // Zahájit útok na konkrétní čtvrť
  startAttack(code, attackerSocketId, targetDistrict) {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'attack') return { success: false, error: 'Není attack fáze.' };

    const attackerIdx = room.players.findIndex(p => p.id === attackerSocketId);
    if (attackerIdx === -1) return { success: false, error: 'Hráč neexistuje.' };

    const defenderIdx = room.mapOwnership[targetDistrict];
    if (defenderIdx === undefined || defenderIdx === attackerIdx) {
      return { success: false, error: 'Nelze napadnout tuto čtvrť.' };
    }

    room.attackState = {
      attackerIndex: attackerIdx,
      defenderIndex: defenderIdx,
      district: targetDistrict,
      scores: { attacker: 0, defender: 0 },
      subRound: 0
    };

    return { success: true };
  }

  // Začít sub-kolo v rámci attack (best of 3)
  startAttackSubRound(code) {
    const room = this.rooms.get(code);
    if (!room || !room.attackState) return null;

    if (this._remainingQuestions(room) === 0) return null;

    room.attackState.subRound++;
    room.roundAnswers = {};
    room.currentQuestion = this._pickQuestion(room);
    if (!room.currentQuestion) return null;

    const q = room.currentQuestion;
    const questionData = {
      id: q.id,
      question: q.question,
      type: q.type
    };

    if (q.type === 'choice') {
      questionData.options = q.options;
    } else {
      questionData.unit = q.unit || '';
    }

    return {
      subRound: room.attackState.subRound,
      question: questionData,
      attackState: {
        district: room.attackState.district,
        attackerName: room.players[room.attackState.attackerIndex].name,
        defenderName: room.players[room.attackState.defenderIndex].name,
        scores: { ...room.attackState.scores }
      }
    };
  }

  // Zpracovat odpověď během attack sub-kola (jen attacker a defender odpovídají)
  submitAttackAnswer(code, socketId, answerValue, timestamp) {
    const room = this.rooms.get(code);
    if (!room || !room.attackState || !room.currentQuestion) return { success: false };

    const atk = room.attackState;
    const attackerId = room.players[atk.attackerIndex].id;
    const defenderId = room.players[atk.defenderIndex].id;

    // Jen attacker a defender mohou odpovídat
    if (socketId !== attackerId && socketId !== defenderId) {
      return { success: false, error: 'Nejsi účastník tohoto souboje.' };
    }

    if (room.roundAnswers[socketId]) return { success: false, error: 'Už jsi odpověděl.' };

    const q = room.currentQuestion;
    if (q.type === 'choice') {
      room.roundAnswers[socketId] = {
        answer: answerValue,
        time: timestamp,
        correct: answerValue === q.correct
      };
    } else {
      room.roundAnswers[socketId] = {
        answer: Number(answerValue),
        time: timestamp,
        diff: Math.abs(Number(answerValue) - q.correct)
      };
    }

    // Oba odpověděli?
    const bothAnswered = room.roundAnswers[attackerId] && room.roundAnswers[defenderId];
    // Nebo jeden se odpojil
    const attackerDisconnected = room.players[atk.attackerIndex].disconnected;
    const defenderDisconnected = room.players[atk.defenderIndex].disconnected;
    const effectivelyDone = bothAnswered ||
      (attackerDisconnected && room.roundAnswers[defenderId]) ||
      (defenderDisconnected && room.roundAnswers[attackerId]);

    return { success: true, allAnswered: effectivelyDone };
  }

  // Vyhodnotit sub-kolo attack
  evaluateAttackSubRound(code) {
    const room = this.rooms.get(code);
    if (!room || !room.attackState) return null;

    const q = room.currentQuestion;
    const atk = room.attackState;
    const attackerId = room.players[atk.attackerIndex].id;
    const defenderId = room.players[atk.defenderIndex].id;
    const atkAnswer = room.roundAnswers[attackerId];
    const defAnswer = room.roundAnswers[defenderId];

    let subWinner = null; // 'attacker' | 'defender' | null

    if (q.type === 'choice') {
      // Kdo odpověděl správně a rychleji
      const atkOk = atkAnswer && atkAnswer.correct;
      const defOk = defAnswer && defAnswer.correct;

      if (atkOk && defOk) {
        subWinner = atkAnswer.time <= defAnswer.time ? 'attacker' : 'defender';
      } else if (atkOk) {
        subWinner = 'attacker';
      } else if (defOk) {
        subWinner = 'defender';
      }
      // Oba špatně = nikdo (remíza, neboduje se)
    } else {
      // Estimate — kdo je blíž (ale oba musí být v toleranci)
      const tolerance = this._estimateTolerance(q.correct);
      const atkDiff = atkAnswer ? atkAnswer.diff : Infinity;
      const defDiff = defAnswer ? defAnswer.diff : Infinity;
      const atkOk = atkDiff <= tolerance;
      const defOk = defDiff <= tolerance;

      if (atkOk && defOk) {
        // Oba v toleranci — bližší vyhrává
        if (atkDiff < defDiff) subWinner = 'attacker';
        else if (defDiff < atkDiff) subWinner = 'defender';
        else subWinner = atkAnswer.time <= defAnswer.time ? 'attacker' : 'defender';
      } else if (atkOk) {
        subWinner = 'attacker';
      } else if (defOk) {
        subWinner = 'defender';
      }
      // Oba mimo toleranci = nikdo (remíza)
    }

    if (subWinner === 'attacker') atk.scores.attacker++;
    if (subWinner === 'defender') atk.scores.defender++;

    // Kontrola vítěze best of 3
    let battleOver = false;
    let battleWinner = null;

    if (atk.scores.attacker >= 2) {
      battleOver = true;
      battleWinner = 'attacker';
    } else if (atk.scores.defender >= 2) {
      battleOver = true;
      battleWinner = 'defender';
    } else if (atk.subRound >= 3) {
      // Po 3 sub-kolech — ten kdo má víc bodů
      battleOver = true;
      if (atk.scores.attacker > atk.scores.defender) battleWinner = 'attacker';
      else if (atk.scores.defender > atk.scores.attacker) battleWinner = 'defender';
      else battleWinner = 'defender'; // pří remíze obránce udrží
    }

    // Pokud útočník vyhrál — přesuň čtvrť
    if (battleOver && battleWinner === 'attacker') {
      room.mapOwnership[atk.district] = atk.attackerIndex;
      room.players[atk.attackerIndex].score++;
      room.players[atk.defenderIndex].score--;
    }

    // Game over check (dominance)
    let gameOver = false;
    let gameOverReason = null;
    if (battleOver) {
      for (const p of room.players) {
        if (p.score >= WIN_DISTRICT_COUNT) {
          gameOver = true;
          gameOverReason = 'dominance';
          break;
        }
      }
      if (!gameOver && this._remainingQuestions(room) === 0) {
        gameOver = true;
        gameOverReason = 'no-questions';
      }
    }

    if (gameOver) {
      room.state = 'finished';
    }

    room.currentQuestion = null;

    const result = {
      correctAnswer: q.type === 'choice' ? q.correct : null,
      correctValue: q.type === 'estimate' ? q.correct : null,
      questionType: q.type,
      unit: q.unit || null,
      subWinner,
      attackScores: { ...atk.scores },
      battleOver,
      battleWinner,
      district: atk.district,
      attackerName: room.players[atk.attackerIndex].name,
      defenderName: room.players[atk.defenderIndex].name,
      mapOwnership: { ...room.mapOwnership },
      scores: room.players.map(p => ({ name: p.name, score: p.score })),
      answers: room.roundAnswers,
      gameOver,
      gameOverReason
    };

    if (battleOver) {
      room.attackState = null;
      room.attackTurnIndex++;
      room.attackRoundsPlayed++;
    }

    return result;
  }

  // Vypočítat toleranci pro estimate otázky
  // Clamp(|correct| * 5%, min=1, max=25)
  // - min=1 zajistí, že malá čísla (5, 6, 8) mají toleranci ±1
  // - max=25 zajistí, že velká čísla (letopočty ~2000) nemají toleranci ±100
  _estimateTolerance(correctValue) {
    const raw = Math.abs(correctValue) * ESTIMATE_TOLERANCE;
    return Math.max(Math.min(raw, ESTIMATE_MAX_TOLERANCE), ESTIMATE_MIN_TOLERANCE);
  }

  // Fisher-Yates shuffle
  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

module.exports = GameManager;

// Scotland Yard - Game Engine
// Depends on graph-data.js globals: NODES, EDGES, ADJ, START_POSITIONS,
// REVEAL_TURNS, MAX_TURNS, DETECTIVE_TICKETS, MRX_STARTING_TICKETS, DETECTIVE_COLORS

window.GameEngine = class GameEngine {
  constructor() {
    this.state = this._defaultState();
  }

  _defaultState() {
    return {
      phase: 'setup',
      turn: 1,
      currentPlayerIndex: -1,  // -1 = Mr. X, 0-4 = detectives
      isDoubleMoveSecondPart: false,
      mrX: {
        position: null,
        lastRevealedPosition: null,
        lastRevealedTurn: 0,
        tickets: { ...MRX_STARTING_TICKETS },
        travelLog: [],
      },
      detectives: [],
      numDetectives: 5,
      numPlayers: 3,
      winner: null,
      winReason: '',
    };
  }

  // ── Setup ──────────────────────────────────────────────────────────────

  setupGame(numPlayers, names) {
    if (numPlayers < 3 || numPlayers > 6) {
      throw new Error('Scotland Yard requires 3-6 players');
    }

    this.state = this._defaultState();
    this.state.numPlayers = numPlayers;
    this.state.numDetectives = 5; // always 5 detectives regardless of player count
    this.state.phase = 'playing';

    // Shuffle start positions and assign
    const positions = this._shuffle([...START_POSITIONS]);
    this.state.mrX.position = positions[0];

    // Assign detectives to players:
    // Player 0 is always Mr. X. Remaining players (numPlayers-1) control 5 detectives.
    // 6p: 1 each, 5p: one player gets 2, 4p: two get 2, 3p: one gets 3 + one gets 2
    const detPlayerCount = numPlayers - 1;
    const assignment = this._distributePawns(5, detPlayerCount);

    for (let i = 0; i < 5; i++) {
      this.state.detectives.push({
        name: DETECTIVE_COLORS[i].name,
        color: DETECTIVE_COLORS[i].color,
        position: positions[i + 1],
        tickets: { ...DETECTIVE_TICKETS },
        stranded: false,
        controlledBy: assignment[i], // player index (1-based for det players)
      });
    }

    // Apply player names if provided
    if (names && names.length > 0) {
      // names[0] = Mr. X name, names[1..] = detective player names
      this.state.mrX.playerName = names[0] || 'Mr. X';
      for (let i = 0; i < 5; i++) {
        const playerIdx = assignment[i]; // 1-based det player index
        this.state.detectives[i].playerName = names[playerIdx] || `Player ${playerIdx + 1}`;
      }
    }

    this.state.currentPlayerIndex = -1; // Mr. X goes first
    return this.getState();
  }

  // Distribute 5 detectives among detPlayerCount players.
  // Returns array[5] mapping detective index -> player index (1-based).
  _distributePawns(numDets, detPlayerCount) {
    // Each player gets at least 1 pawn. Remaining pawns distributed round-robin.
    const perPlayer = Array(detPlayerCount).fill(0);
    const remaining = numDets;

    // Base allocation
    for (let i = 0; i < detPlayerCount; i++) {
      perPlayer[i] = Math.floor(remaining / detPlayerCount);
    }
    // Distribute remainder
    const extra = remaining % detPlayerCount;
    for (let i = 0; i < extra; i++) {
      perPlayer[i]++;
    }
    // 5 dets, 5 players -> [1,1,1,1,1]
    // 5 dets, 4 players -> [2,1,1,1]      (first player gets 2)
    // 5 dets, 3 players -> [2,2,1]         (first two get 2)
    // 5 dets, 2 players -> [3,2]           (one gets 3, one gets 2)

    // Build assignment: detective index -> player index (1-based)
    const assignment = [];
    for (let p = 0; p < detPlayerCount; p++) {
      for (let d = 0; d < perPlayer[p]; d++) {
        assignment.push(p + 1); // 1-based player index
      }
    }
    return assignment;
  }

  // ── Core Queries ───────────────────────────────────────────────────────

  getReachableNodes(position, tickets, useBlack = false) {
    const edges = ADJ[position] || [];
    const detectivePositions = new Set(
      this.state.detectives.map(d => d.position)
    );

    const reachable = [];

    for (const edge of edges) {
      // Can't move to a detective-occupied spot
      if (detectivePositions.has(edge.to)) continue;

      if (edge.type === 'boat') {
        // Boat routes require a black ticket
        if (useBlack && tickets.black > 0) {
          reachable.push({ node: edge.to, ticket: 'black', type: 'boat' });
        }
      } else if (useBlack && tickets.black > 0) {
        // Black ticket can substitute for any transport type
        reachable.push({ node: edge.to, ticket: 'black', type: edge.type });
      }

      // Normal ticket for this edge type
      if (edge.type !== 'boat' && tickets[edge.type] > 0) {
        reachable.push({ node: edge.to, ticket: edge.type, type: edge.type });
      }
    }

    // Deduplicate: same node can appear via different tickets, that's intended.
    // But same node + same ticket should be unique.
    const seen = new Set();
    return reachable.filter(r => {
      const key = `${r.node}-${r.ticket}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  getCurrentPlayer() {
    if (this.state.currentPlayerIndex === -1) {
      return { type: 'mrX', data: this.state.mrX };
    }
    return {
      type: 'detective',
      index: this.state.currentPlayerIndex,
      data: this.state.detectives[this.state.currentPlayerIndex],
    };
  }

  isRevealTurn(turn) {
    return REVEAL_TURNS.includes(turn || this.state.turn);
  }

  canDetectiveMove(detectiveIndex) {
    const det = this.state.detectives[detectiveIndex];
    if (!det || det.stranded) return false;
    const reachable = this.getReachableNodes(det.position, det.tickets);
    return reachable.length > 0;
  }

  // ── Move Execution ─────────────────────────────────────────────────────

  makeMove(targetNode, ticketType) {
    if (this.state.phase !== 'playing') {
      return { success: false, error: 'Game is not in playing phase' };
    }

    const isMrX = this.state.currentPlayerIndex === -1;
    const player = isMrX
      ? this.state.mrX
      : this.state.detectives[this.state.currentPlayerIndex];

    // Validate the move
    const canUseBlack = isMrX; // only Mr. X has black tickets
    const reachable = this.getReachableNodes(player.position, player.tickets, canUseBlack);
    const validMove = reachable.find(
      r => r.node === targetNode && r.ticket === ticketType
    );

    if (!validMove) {
      return { success: false, error: 'Invalid move' };
    }

    // Validate ticket
    if (player.tickets[ticketType] === undefined || player.tickets[ticketType] <= 0) {
      return { success: false, error: `No ${ticketType} tickets remaining` };
    }

    // Execute move
    player.tickets[ticketType]--;
    player.position = targetNode;

    if (isMrX) {
      // Determine the effective turn for this move in the travel log
      const logTurn = this.state.isDoubleMoveSecondPart
        ? this.state.turn // second part uses same turn
        : this.state.turn;
      const revealed = this.isRevealTurn(logTurn);

      this.state.mrX.travelLog.push({
        turn: logTurn,
        ticket: ticketType,
        position: revealed ? targetNode : null,
        revealed,
      });

      if (revealed) {
        this.state.mrX.lastRevealedPosition = targetNode;
        this.state.mrX.lastRevealedTurn = logTurn;
      }
    } else {
      // Detective's used ticket goes to Mr. X
      if (this.state.mrX.tickets[ticketType] !== undefined) {
        this.state.mrX.tickets[ticketType]++;
      }
    }

    // Check win/loss
    const gameOverResult = this.checkGameOver();
    if (gameOverResult) {
      this.state.phase = 'gameover';
      this.state.winner = gameOverResult.winner;
      this.state.winReason = gameOverResult.reason;
      return { success: true, gameOver: true, ...gameOverResult };
    }

    // Advance to next player
    if (!this.state.isDoubleMoveSecondPart || !isMrX) {
      this.state.isDoubleMoveSecondPart = false;
      this.advanceToNextPlayer();
    } else {
      // Completing second part of double move
      this.state.isDoubleMoveSecondPart = false;
      this.advanceToNextPlayer();
    }

    return { success: true, gameOver: false };
  }

  startDoubleMove() {
    if (this.state.currentPlayerIndex !== -1) {
      return { success: false, error: 'Only Mr. X can use double move' };
    }
    if (this.state.mrX.tickets.double <= 0) {
      return { success: false, error: 'No double move tickets remaining' };
    }

    this.state.mrX.tickets.double--;
    this.state.isDoubleMoveSecondPart = true;
    // Mr. X will make two consecutive moves before detectives go
    return { success: true };
  }

  // ── Game Over ──────────────────────────────────────────────────────────

  checkGameOver() {
    // 1. A detective on Mr. X's position = detectives win
    for (const det of this.state.detectives) {
      if (det.position === this.state.mrX.position) {
        return { winner: 'detectives', reason: `${det.name} detective caught Mr. X!` };
      }
    }

    // 2. Mr. X has no legal moves (when it's their turn) = detectives win
    if (this.state.currentPlayerIndex === -1) {
      const mrXMoves = this.getReachableNodes(
        this.state.mrX.position,
        this.state.mrX.tickets,
        true
      );
      if (mrXMoves.length === 0) {
        return { winner: 'detectives', reason: 'Mr. X is cornered with no legal moves!' };
      }
    }

    // 3. All detectives are stranded = Mr. X wins
    const allStranded = this.state.detectives.every(d => d.stranded);
    if (allStranded) {
      return { winner: 'mrX', reason: 'All detectives are stranded!' };
    }

    // 4. Turn 24 completed (all detectives moved) = Mr. X wins
    if (this.state.turn > MAX_TURNS) {
      return { winner: 'mrX', reason: 'Mr. X evaded capture for 24 turns!' };
    }

    return null; // game continues
  }

  // ── Player Advancement ─────────────────────────────────────────────────

  advanceToNextPlayer() {
    if (this.state.currentPlayerIndex === -1) {
      // Mr. X just moved, go to first detective
      this.state.currentPlayerIndex = 0;
      this._skipStranded();
    } else {
      const next = this.state.currentPlayerIndex + 1;
      if (next >= this.state.numDetectives) {
        // All detectives have moved, new turn
        this.state.turn++;
        this.state.currentPlayerIndex = -1; // Mr. X's turn

        // Check if game is over due to turn limit
        const gameOverResult = this.checkGameOver();
        if (gameOverResult) {
          this.state.phase = 'gameover';
          this.state.winner = gameOverResult.winner;
          this.state.winReason = gameOverResult.reason;
        }
      } else {
        this.state.currentPlayerIndex = next;
        this._skipStranded();
      }
    }

    // Update stranded status for all detectives
    this._updateStrandedStatus();
  }

  skipStranded() {
    this._skipStranded();
  }

  _skipStranded() {
    // Skip stranded detectives
    while (
      this.state.currentPlayerIndex >= 0 &&
      this.state.currentPlayerIndex < this.state.numDetectives
    ) {
      const det = this.state.detectives[this.state.currentPlayerIndex];
      if (!det.stranded && this.canDetectiveMove(this.state.currentPlayerIndex)) {
        break;
      }
      det.stranded = true;

      const next = this.state.currentPlayerIndex + 1;
      if (next >= this.state.numDetectives) {
        // All remaining detectives stranded this round
        this.state.turn++;
        this.state.currentPlayerIndex = -1;

        const gameOverResult = this.checkGameOver();
        if (gameOverResult) {
          this.state.phase = 'gameover';
          this.state.winner = gameOverResult.winner;
          this.state.winReason = gameOverResult.reason;
        }
        return;
      }
      this.state.currentPlayerIndex = next;
    }
  }

  _updateStrandedStatus() {
    for (let i = 0; i < this.state.detectives.length; i++) {
      const det = this.state.detectives[i];
      if (!det.stranded) {
        const moves = this.getReachableNodes(det.position, det.tickets);
        if (moves.length === 0) {
          det.stranded = true;
        }
      }
    }
  }

  // ── State ──────────────────────────────────────────────────────────────

  getState() {
    // Return state in flat-players format for UIController compatibility
    // players[0] = Mr. X, players[1..5] = detectives
    const s = JSON.parse(JSON.stringify(this.state));
    const players = [];
    // Mr. X as player 0
    players.push({
      name: 'Mr. X',
      color: '#000000',
      isMrX: true,
      position: s.mrX.position,
      tickets: { ...s.mrX.tickets },
      travelLog: s.mrX.travelLog,
      lastRevealedPosition: s.mrX.lastRevealedPosition,
      lastRevealedTurn: s.mrX.lastRevealedTurn,
      stranded: false,
      pawns: [{ position: s.mrX.position, color: '#000' }]
    });
    // Detectives as players 1..5
    for (const d of s.detectives) {
      players.push({
        name: d.name,
        color: d.color,
        isMrX: false,
        position: d.position,
        tickets: { ...d.tickets },
        stranded: d.stranded || false,
        controlledBy: d.controlledBy,
        pawns: [{ position: d.position, color: d.color }]
      });
    }
    // Map currentPlayerIndex: internal -1 -> 0 (mrx), 0-4 -> 1-5
    const mappedIndex = s.currentPlayerIndex === -1 ? 0 : s.currentPlayerIndex + 1;
    return {
      phase: s.phase,
      turn: s.turn,
      currentPlayerIndex: mappedIndex,
      isDoubleMoveSecondPart: s.isDoubleMoveSecondPart,
      players: players,
      numDetectives: s.numDetectives,
      numPlayers: s.numPlayers,
      winner: s.winner,
      winReason: s.winReason,
      travelLog: s.mrX.travelLog,
      gameOver: s.phase === 'gameover'
    };
  }

  loadState(data) {
    // Convert from flat-players format back to internal format
    if (data.players) {
      const mrxPlayer = data.players[0];
      const state = this._defaultState();
      state.phase = data.phase;
      state.turn = data.turn;
      state.currentPlayerIndex = data.currentPlayerIndex === 0 ? -1 : data.currentPlayerIndex - 1;
      state.isDoubleMoveSecondPart = data.isDoubleMoveSecondPart || false;
      state.numDetectives = data.numDetectives || 5;
      state.numPlayers = data.numPlayers || 3;
      state.winner = data.winner;
      state.winReason = data.winReason || '';
      state.mrX = {
        position: mrxPlayer.position,
        lastRevealedPosition: mrxPlayer.lastRevealedPosition || null,
        lastRevealedTurn: mrxPlayer.lastRevealedTurn || 0,
        tickets: { ...mrxPlayer.tickets },
        travelLog: mrxPlayer.travelLog || data.travelLog || []
      };
      state.detectives = [];
      for (let i = 1; i < data.players.length; i++) {
        const p = data.players[i];
        state.detectives.push({
          name: p.name,
          color: p.color,
          position: p.position,
          tickets: { ...p.tickets },
          stranded: p.stranded || false,
          controlledBy: p.controlledBy
        });
      }
      this.state = state;
    } else {
      this.state = JSON.parse(JSON.stringify(data));
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
};

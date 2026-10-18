// Scotland Yard – UI Controller (pass-and-play)
// Depends on: window.GameEngine, window.BoardRenderer, graph-data.js globals

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'style' && typeof v === 'object') {
          Object.assign(e.style, v);
        } else if (k.startsWith('on')) {
          e.addEventListener(k.slice(2), v);
        } else if (k === 'className') {
          e.className = v;
        } else {
          e.setAttribute(k, v);
        }
      }
    }
    if (children != null) {
      if (typeof children === 'string') {
        e.textContent = children;
      } else if (Array.isArray(children)) {
        children.forEach(function (c) {
          if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      } else {
        e.appendChild(children);
      }
    }
    return e;
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  var SAVE_KEY = 'scotlandYardSave';

  // ── UIController ────────────────────────────────────────────────────────
  function UIController() {
    this.engine = null;
    this.renderer = null;

    // Screen ids
    this.screens = ['welcome', 'setup', 'starting-positions', 'pass-screen', 'game', 'gameover'];

    // Pending move state
    this._pendingNode = null;
    this._pendingTickets = [];
    this._activePawnIndex = 0; // For multi-pawn detective control

    // Travel log visibility
    this._travelLogOpen = false;

    this._bindDOM();
    this._attachListeners();
    this._checkSavedGame();
  }

  // ── DOM references ──────────────────────────────────────────────────────
  UIController.prototype._bindDOM = function () {
    this.$screens = {};
    this.screens.forEach(function (id) {
      this.$screens[id] = $('#screen-' + id);
    }.bind(this));
    this.$rulesModal = $('#rules-modal');

    // Welcome
    this.$btnNewGame = $('#btn-new-game');
    this.$btnContinue = $('#btn-continue');
    this.$btnRulesWelcome = $('#btn-rules-welcome');

    // Setup
    this.$numPlayersSelect = $('#num-players-select');
    this.$playerNamesContainer = $('#player-names-container');
    this.$btnStartGame = $('#btn-start-game');
    this.$btnBackSetup = $('#btn-back-setup');

    // Pass screen
    this.$passTitle = $('#pass-title');    this.$passSubtitle = $('#pass-subtitle');
    this.$btnReady = $('#btn-ready');

    // Starting positions screen
    this.$startPosCards = $('#start-pos-cards');
    this.$btnBeginGame = $('#btn-begin-game');

    // Game screen
    this.$boardContainer = $('#board-container');
    this.$turnInfo = $('#turn-info');
    this.$playerLabel = $('#player-label');
    this.$ticketBar = $('#ticket-bar');
    this.$moveConfirm = $('#move-confirm');
    this.$btnConfirmMove = $('#btn-confirm-move');
    this.$btnCancelMove = $('#btn-cancel-move');
    this.$mrxToggles = $('#mrx-toggles');
    this.$btnDouble = $('#btn-double-move');
    this.$btnBlack = $('#btn-black-ticket');
    this.$btnTravelLog = $('#btn-travel-log');
    this.$travelLogPanel = $('#travel-log-panel');
    this.$travelLogList = $('#travel-log-list');
    this.$btnRulesGame = $('#btn-rules-game');
    this.$pawnIndicator = $('#pawn-indicator');

    // Ticket picker overlay
    this.$ticketPicker = $('#ticket-picker');

    // Game over
    this.$winnerTitle = $('#winner-title');
    this.$winnerReason = $('#winner-reason');
    this.$btnNewGameOver = $('#btn-new-game-over');

    // Rules modal
    this.$btnCloseRules = $('#btn-close-rules');

    // Reveal overlay
    this.$revealOverlay = $('#reveal-overlay');
  };

  // ── Event listeners ─────────────────────────────────────────────────────
  UIController.prototype._attachListeners = function () {
    var self = this;

    // Welcome
    this.$btnNewGame.addEventListener('click', function () {
      self.showScreen('setup');
      self._renderPlayerNameInputs(parseInt(self.$numPlayersSelect.value, 10) || 3);
    });
    this.$btnContinue.addEventListener('click', function () { self.loadGame(); });
    if (this.$btnRulesWelcome) {
      this.$btnRulesWelcome.addEventListener('click', function () { self.showRules(); });
    }

    // Setup
    this.$numPlayersSelect.addEventListener('change', function () {
      self._renderPlayerNameInputs(parseInt(this.value, 10));
    });
    this.$btnStartGame.addEventListener('click', function () { self._onStartGame(); });
    this.$btnBackSetup.addEventListener('click', function () { self.showScreen('welcome'); });

    // Pass screen
    this.$btnReady.addEventListener('click', function () { self._onReady(); });

    // Begin game (after starting positions shown)
    if (this.$btnBeginGame) {
      this.$btnBeginGame.addEventListener('click', function () { self.startTurn(); });
    }

    // Game – move confirmation
    this.$btnConfirmMove.addEventListener('click', function () { self._onConfirmMove(); });
    this.$btnCancelMove.addEventListener('click', function () { self._clearPendingMove(); });

    // Mr. X toggles
    if (this.$btnDouble) {
      this.$btnDouble.addEventListener('click', function () { this.classList.toggle('active'); });
    }
    if (this.$btnBlack) {
      this.$btnBlack.addEventListener('click', function () { this.classList.toggle('active'); });
    }

    // Travel log
    if (this.$btnTravelLog) {
      this.$btnTravelLog.addEventListener('click', function () { self._toggleTravelLog(); });
    }

    // Rules from game screen
    if (this.$btnRulesGame) {
      this.$btnRulesGame.addEventListener('click', function () { self.showRules(); });
    }

    // Rules modal close
    if (this.$btnCloseRules) {
      this.$btnCloseRules.addEventListener('click', function () { self._hideRules(); });
    }
    if (this.$rulesModal) {
      this.$rulesModal.addEventListener('click', function (e) {
        if (e.target === self.$rulesModal) self._hideRules();
      });
    }

    // Game over
    if (this.$btnNewGameOver) {
      this.$btnNewGameOver.addEventListener('click', function () {
        localStorage.removeItem(SAVE_KEY);
        self.showScreen('setup');
      });
    }
  };

  // ── Screen management ───────────────────────────────────────────────────
  UIController.prototype.showScreen = function (id) {
    for (var key in this.$screens) {
      if (this.$screens[key]) {
        if (key === id) {
          this.$screens[key].classList.remove('hidden');
        } else {
          this.$screens[key].classList.add('hidden');
        }
      }
    }
    // Close travel log when leaving game screen
    if (id !== 'game' && this._travelLogOpen) {
      this._toggleTravelLog();
    }
  };

  // ── Setup helpers ───────────────────────────────────────────────────────
  UIController.prototype._renderPlayerNameInputs = function (count) {
    var container = this.$playerNamesContainer;
    container.innerHTML = '';
    // Player 0 is Mr. X (always present)
    var mrxRow = el('div', { className: 'player-name-row' }, [
      el('label', { 'for': 'pname-0', className: 'player-label-tag mrx' }, 'Mr. X'),
      el('input', { type: 'text', id: 'pname-0', placeholder: 'Mr. X player name', maxlength: '20' })
    ]);
    container.appendChild(mrxRow);

    for (var i = 1; i < count; i++) {
      var color = DETECTIVE_COLORS[i - 1] || { name: 'Det ' + i, color: '#888' };
      var row = el('div', { className: 'player-name-row' }, [
        el('label', {
          'for': 'pname-' + i,
          className: 'player-label-tag detective',
          style: { backgroundColor: color.color, color: '#fff' }
        }, color.name + ' Detective'),
        el('input', { type: 'text', id: 'pname-' + i, placeholder: color.name + ' detective name', maxlength: '20' })
      ]);
      container.appendChild(row);
    }
  };

  UIController.prototype._checkSavedGame = function () {
    var saved = localStorage.getItem(SAVE_KEY);
    if (this.$btnContinue) {
      this.$btnContinue.style.display = saved ? '' : 'none';
    }
  };

  // ── Start game ──────────────────────────────────────────────────────────
  UIController.prototype._onStartGame = function () {
    var numPlayers = parseInt(this.$numPlayersSelect.value, 10);
    var names = [];
    for (var i = 0; i < numPlayers; i++) {
      var input = $('#pname-' + i);
      var val = input ? input.value.trim() : '';
      if (i === 0) {
        names.push(val || 'Mr. X');
      } else {
        var fallback = (DETECTIVE_COLORS[i - 1] ? DETECTIVE_COLORS[i - 1].name : 'Det ' + i);
        names.push(val || fallback);
      }
    }
    this.startGame(numPlayers, names);
  };

  UIController.prototype.startGame = function (numPlayers, names) {
    this.engine = new window.GameEngine();
    this.engine.setupGame(numPlayers, names);
    this.renderer = new window.BoardRenderer('board-container');
    this.renderer.render();
    this.renderer.onNodeClick(this._onNodeClick.bind(this));
    this._activePawnIndex = 0;
    this._showStartingPositions();
  };

  UIController.prototype._showStartingPositions = function () {
    var state = this.engine.getState();
    var container = this.$startPosCards;
    if (!container) { this.startTurn(); return; }
    container.innerHTML = '';

    // Mr. X card
    var mrx = state.players[0];
    var mrxCard = el('div', { className: 'start-pos-card mrx-card' }, [
      el('div', { className: 'start-pos-badge mrx-badge' }, '🕵️ Mr. X'),
      el('div', { className: 'start-pos-name' }, mrx.name),
      el('div', { className: 'start-pos-station' }, 'Station ' + mrx.position),
      el('div', { className: 'start-pos-note' }, 'Keep your station secret!')
    ]);
    container.appendChild(mrxCard);

    // Detective cards
    state.players.slice(1).forEach(function (det, i) {
      var dc = DETECTIVE_COLORS[i] || { color: '#888', name: 'Det' };
      var card = el('div', { className: 'start-pos-card det-card', style: { borderColor: dc.color } }, [
        el('div', { className: 'start-pos-badge', style: { backgroundColor: dc.color } }, '🔍 Detective'),
        el('div', { className: 'start-pos-name' }, det.name),
        el('div', { className: 'start-pos-station', style: { color: dc.color } }, 'Station ' + det.position)
      ]);
      container.appendChild(card);
    });

    this.showScreen('starting-positions');
  };

  // ── Turn flow ───────────────────────────────────────────────────────────
  UIController.prototype.startTurn = function () {
    var state = this.engine.getState();
    var current = state.players[state.currentPlayerIndex];
    var isMrx = state.currentPlayerIndex === 0;
    var displayName = current.name;
    var turnNum = state.turn;

    // Check if this is a reveal turn — show reveal overlay before pass screen
    if (!isMrx && REVEAL_TURNS.indexOf(turnNum) !== -1 && state.currentPlayerIndex === 1) {
      // First detective after Mr. X just moved on a reveal turn
      var mrxPos = state.players[0].position;
      this.showReveal(mrxPos, function () {
        this._showPassScreen(displayName, isMrx, turnNum);
      }.bind(this));
      return;
    }

    this._showPassScreen(displayName, isMrx, turnNum);
  };

  UIController.prototype._showPassScreen = function (name, isMrx, turnNum) {
    this.$passTitle.textContent = name;
    this.$passSubtitle.textContent = isMrx ? '🕵️ Mr. X' : '🔍 Detective';

    // Style pass screen differently for Mr. X vs detective
    var passScreen = this.$screens['pass-screen'];
    if (passScreen) {
      passScreen.setAttribute('data-role', isMrx ? 'mrx' : 'detective');
    }

    this.showScreen('pass-screen');
  };

  UIController.prototype._onReady = function () {
    this.showScreen('game');
    this._activePawnIndex = 0;
    this.updateBoard();
    this._updateBottomPanel();
    this._clearPendingMove();
  };

  // ── Node click handler ──────────────────────────────────────────────────
  UIController.prototype._onNodeClick = function (nodeId) {
    var state = this.engine.getState();
    var current = state.players[state.currentPlayerIndex];
    var isMrx = state.currentPlayerIndex === 0;

    // Determine the pawn we're moving
    var pawnPosition;
    if (isMrx) {
      pawnPosition = current.position;
    } else {
      // Multi-pawn detective: use active pawn
      if (current.pawns && current.pawns.length > 1) {
        pawnPosition = current.pawns[this._activePawnIndex].position;
      } else {
        pawnPosition = current.position;
      }
    }

    // Find valid routes from current pawn to clicked node
    var routes = this._getValidRoutes(pawnPosition, nodeId, state, isMrx);
    if (routes.length === 0) return; // Not a valid move

    if (routes.length === 1) {
      // Auto-select single route
      this._setPendingMove(nodeId, routes[0]);
    } else {
      // Multiple ticket options — show picker
      this._showTicketPicker(nodeId, routes);
    }
  };

  UIController.prototype._getValidRoutes = function (fromNode, toNode, state, isMrx) {
    var routes = [];
    var adj = ADJ[fromNode] || [];
    var current = state.players[state.currentPlayerIndex];
    var tickets = current.tickets;

    // Check if black ticket toggle is active (Mr. X only)
    var useBlack = isMrx && this.$btnBlack && this.$btnBlack.classList.contains('active');

    for (var i = 0; i < adj.length; i++) {
      if (adj[i].to !== toNode) continue;
      var type = adj[i].type;

      // Check destination isn't occupied by a detective
      var occupied = false;
      for (var d = 1; d < state.players.length; d++) {
        if (this._getPlayerPosition(state.players[d]) === toNode) {
          // Mr. X can't land on detectives; detectives CAN land on Mr. X
          if (isMrx) { occupied = true; break; }
        }
      }
      if (occupied) continue;

      // Normal ticket
      if (tickets[type] > 0) {
        if (routes.findIndex(function (r) { return r.ticket === type; }) === -1) {
          routes.push({ ticket: type, label: type });
        }
      }
      // Black ticket (Mr. X only, works as any transport)
      if (isMrx && tickets.black > 0 && !useBlack) {
        if (routes.findIndex(function (r) { return r.ticket === 'black'; }) === -1) {
          routes.push({ ticket: 'black', label: 'black' });
        }
      }
    }

    // Boat routes (Mr. X only, requires black ticket)
    if (isMrx && tickets.black > 0) {
      var boatEdges = EDGES.boat || [];
      for (var b = 0; b < boatEdges.length; b++) {
        var edge = boatEdges[b];
        if ((edge[0] === fromNode && edge[1] === toNode) ||
            (edge[1] === fromNode && edge[0] === toNode)) {
          if (routes.findIndex(function (r) { return r.ticket === 'black' && r.boat; }) === -1) {
            routes.push({ ticket: 'black', label: 'boat (black)', boat: true });
          }
        }
      }
    }

    // If black toggle is active, filter to only black
    if (useBlack && isMrx) {
      routes = routes.filter(function (r) { return r.ticket === 'black'; });
    }

    return routes;
  };

  UIController.prototype._getPlayerPosition = function (player) {
    if (player.pawns && player.pawns.length > 0) {
      return player.pawns[0].position;
    }
    return player.position;
  };

  // ── Ticket picker ───────────────────────────────────────────────────────
  UIController.prototype._showTicketPicker = function (nodeId, routes) {
    var self = this;
    var picker = this.$ticketPicker;
    picker.innerHTML = '';

    var title = el('div', { className: 'ticket-picker-title' }, 'Choose ticket to node #' + nodeId);
    picker.appendChild(title);

    routes.forEach(function (route) {
      var btn = el('button', {
        className: 'ticket-option ticket-' + route.ticket,
        style: { minHeight: '48px', minWidth: '48px' },
        onclick: function () {
          self._hideTicketPicker();
          self._setPendingMove(nodeId, route);
        }
      }, route.label.charAt(0).toUpperCase() + route.label.slice(1));
      picker.appendChild(btn);
    });

    var cancelBtn = el('button', {
      className: 'ticket-option ticket-cancel',
      style: { minHeight: '48px', minWidth: '48px' },
      onclick: function () { self._hideTicketPicker(); }
    }, 'Cancel');
    picker.appendChild(cancelBtn);

    picker.classList.add('visible');
  };

  UIController.prototype._hideTicketPicker = function () {
    if (this.$ticketPicker) {
      this.$ticketPicker.classList.remove('visible');
    }
  };

  // ── Pending move ────────────────────────────────────────────────────────
  UIController.prototype._setPendingMove = function (nodeId, route) {
    this._pendingNode = nodeId;
    this._pendingTicket = route.ticket;
    this._pendingBoat = !!route.boat;

    // Highlight destination on board
    if (this.renderer && this.renderer.highlightNode) {
      this.renderer.highlightNode(nodeId, 'pending');
    }

    // Show confirmation bar
    if (this.$moveConfirm) {
      this.$moveConfirm.classList.add('visible');
      var label = this.$moveConfirm.querySelector('.move-confirm-label');
      if (label) {
        label.textContent = 'Move to #' + nodeId + ' using ' + route.label + '?';
      }
    }
  };

  UIController.prototype._clearPendingMove = function () {
    this._pendingNode = null;
    this._pendingTicket = null;
    this._pendingBoat = false;

    if (this.renderer && this.renderer.clearHighlights) {
      this.renderer.clearHighlights();
    }
    if (this.$moveConfirm) {
      this.$moveConfirm.classList.remove('visible');
    }
    this._hideTicketPicker();
  };

  // ── Confirm move ────────────────────────────────────────────────────────
  UIController.prototype._onConfirmMove = function () {
    if (this._pendingNode == null || this._pendingTicket == null) return;

    var state = this.engine.getState();
    var isMrx = state.currentPlayerIndex === 0;

    // Check double move toggle
    var useDouble = isMrx && this.$btnDouble && this.$btnDouble.classList.contains('active');

    this.confirmMove(this._pendingNode, this._pendingTicket, {
      double: useDouble,
      boat: this._pendingBoat,
      pawnIndex: isMrx ? 0 : this._activePawnIndex
    });
  };

  UIController.prototype.confirmMove = function (nodeId, ticket, opts) {
    opts = opts || {};
    var result = this.engine.makeMove(nodeId, ticket, opts);
    if (!result || !result.success) {
      // Move rejected by engine
      this._clearPendingMove();
      return;
    }

    this._clearPendingMove();

    // Reset toggles
    if (this.$btnDouble) this.$btnDouble.classList.remove('active');
    if (this.$btnBlack) this.$btnBlack.classList.remove('active');

    // Check game state after move
    var state = this.engine.getState();

    if (state.gameOver) {
      this.saveGame(); // Save final state
      this.showGameOver(state.winner, state.winReason);
      return;
    }

    // If double move was used by Mr. X, they get another move turn
    if (result.doubleMovePending) {
      this.updateBoard();
      this._updateBottomPanel();
      return; // Stay on game screen for second move
    }

    // Multi-pawn detective: advance to next pawn or next player
    var currentState = this.engine.getState();
    var current = currentState.players[currentState.currentPlayerIndex];
    if (current.pawns && current.pawns.length > 1 && !opts.double) {
      var nextPawnIdx = (opts.pawnIndex || 0) + 1;
      if (nextPawnIdx < current.pawns.length) {
        this._activePawnIndex = nextPawnIdx;
        this.updateBoard();
        this._updateBottomPanel();
        return; // Stay for next pawn
      }
    }

    // Auto-save after each completed move
    this.saveGame();

    // Advance to next turn/player
    this.startTurn();
  };

  // ── Board update ────────────────────────────────────────────────────────
  UIController.prototype.updateBoard = function () {
    if (!this.engine || !this.renderer) return;

    var state = this.engine.getState();
    var isMrxTurn = state.currentPlayerIndex === 0;
    var turnNumber = state.turn;
    var isRevealTurn = REVEAL_TURNS.indexOf(turnNumber) !== -1;

    // Build pawn data for renderer
    var pawns = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (i === 0) {
        // Mr. X
        if (isMrxTurn) {
          // Mr. X's own turn: show real position
          pawns.push({
            id: 'mrx',
            nodeId: p.position,
            color: '#1a1a2e',
            label: 'X',
            visible: true
          });
        } else if (isRevealTurn) {
          // Reveal turn: show Mr. X at current position
          pawns.push({
            id: 'mrx',
            nodeId: p.position,
            color: '#1a1a2e',
            label: 'X',
            visible: true,
            revealed: true
          });
        } else {
          // Detective turn, not a reveal: show gray ghost at last reveal
          var lastReveal = this._getLastRevealPosition(state);
          if (lastReveal != null) {
            pawns.push({
              id: 'mrx-ghost',
              nodeId: lastReveal,
              color: '#888',
              label: '?',
              visible: true,
              ghost: true
            });
          }
        }
      } else {
        // Detective
        var detColor = DETECTIVE_COLORS[i - 1] || { color: '#888' };
        if (p.pawns && p.pawns.length > 1) {
          // Multi-pawn detective
          p.pawns.forEach(function (pawn, pi) {
            pawns.push({
              id: 'det-' + i + '-' + pi,
              nodeId: pawn.position,
              color: detColor.color,
              label: '' + i,
              visible: true,
              active: state.currentPlayerIndex === i && pi === this._activePawnIndex
            });
          }.bind(this));
        } else {
          pawns.push({
            id: 'det-' + i,
            nodeId: p.position,
            color: detColor.color,
            label: '' + i,
            visible: true,
            active: state.currentPlayerIndex === i
          });
        }
      }
    }

    this.renderer.updatePawns(pawns);

    // Highlight valid moves for current player
    var currentPlayer = state.players[state.currentPlayerIndex];
    var fromNode;
    if (state.currentPlayerIndex === 0) {
      fromNode = currentPlayer.position;
    } else if (currentPlayer.pawns && currentPlayer.pawns.length > 1) {
      fromNode = currentPlayer.pawns[this._activePawnIndex].position;
    } else {
      fromNode = currentPlayer.position;
    }

    var validMoves = this._computeValidMoves(fromNode, state);
    if (this.renderer.highlightReachable) {
      this.renderer.highlightReachable(validMoves);
      this.renderer.setNodeInteractive(validMoves);
    }

    // Update turn info
    this._updateTurnInfo(state);
  };

  UIController.prototype._getLastRevealPosition = function (state) {
    var log = state.travelLog || [];
    for (var i = log.length - 1; i >= 0; i--) {
      if (log[i].revealed) {
        return log[i].position;
      }
    }
    return null;
  };

  UIController.prototype._computeValidMoves = function (fromNode, state) {
    var adj = ADJ[fromNode] || [];
    var isMrx = state.currentPlayerIndex === 0;
    var tickets = state.players[state.currentPlayerIndex].tickets;
    var valid = [];

    for (var i = 0; i < adj.length; i++) {
      var dest = adj[i].to;
      var type = adj[i].type;

      // Check not occupied by detective (Mr. X can't land on them)
      if (isMrx) {
        var blocked = false;
        for (var d = 1; d < state.players.length; d++) {
          if (this._getPlayerPosition(state.players[d]) === dest) {
            blocked = true; break;
          }
        }
        if (blocked) continue;
      } else {
        // Detectives can't land on each other (but can land on Mr. X)
        var detBlocked = false;
        for (var d2 = 1; d2 < state.players.length; d2++) {
          if (d2 === state.currentPlayerIndex) continue;
          if (this._getPlayerPosition(state.players[d2]) === dest) {
            detBlocked = true; break;
          }
        }
        if (detBlocked) continue;
      }

      // Check ticket availability
      if (tickets[type] > 0 || (isMrx && tickets.black > 0)) {
        if (valid.indexOf(dest) === -1) valid.push(dest);
      }
    }

    // Boat routes for Mr. X
    if (isMrx && tickets.black > 0) {
      var boatEdges = EDGES.boat || [];
      for (var b = 0; b < boatEdges.length; b++) {
        var e = boatEdges[b];
        var boatDest = null;
        if (e[0] === fromNode) boatDest = e[1];
        else if (e[1] === fromNode) boatDest = e[0];
        if (boatDest != null && valid.indexOf(boatDest) === -1) {
          valid.push(boatDest);
        }
      }
    }

    return valid;
  };

  // ── Turn info header ────────────────────────────────────────────────────
  UIController.prototype._updateTurnInfo = function (state) {
    if (this.$turnInfo) {
      this.$turnInfo.textContent = 'Turn ' + state.turn + ' / ' + MAX_TURNS;
    }
    if (this.$playerLabel) {
      var current = state.players[state.currentPlayerIndex];
      var isMrx = state.currentPlayerIndex === 0;
      this.$playerLabel.textContent = current.name + (isMrx ? ' (Mr. X)' : '');
      this.$playerLabel.setAttribute('data-role', isMrx ? 'mrx' : 'detective');
    }
  };

  // ── Bottom panel ────────────────────────────────────────────────────────
  UIController.prototype._updateBottomPanel = function () {
    var state = this.engine.getState();
    var current = state.players[state.currentPlayerIndex];
    var isMrx = state.currentPlayerIndex === 0;

    // Ticket counts
    this._renderTicketBar(current.tickets, isMrx);

    // Mr. X special toggles visibility
    if (this.$mrxToggles) {
      this.$mrxToggles.style.display = isMrx ? '' : 'none';
    }
    if (this.$btnDouble && isMrx) {
      this.$btnDouble.disabled = (current.tickets.double || 0) <= 0;
      this.$btnDouble.textContent = '2× (' + (current.tickets.double || 0) + ')';
    }
    if (this.$btnBlack && isMrx) {
      this.$btnBlack.disabled = (current.tickets.black || 0) <= 0;
      this.$btnBlack.textContent = '⬛ Black (' + (current.tickets.black || 0) + ')';
    }

    // Pawn indicator for multi-pawn detective
    this._updatePawnIndicator(state);
  };

  UIController.prototype._renderTicketBar = function (tickets, isMrx) {
    var bar = this.$ticketBar;
    if (!bar) return;
    bar.innerHTML = '';

    var types = isMrx
      ? [['taxi', '🚕'], ['bus', '🚌'], ['underground', '🚇'], ['black', '⬛']]
      : [['taxi', '🚕'], ['bus', '🚌'], ['underground', '🚇']];

    types.forEach(function (entry) {
      var type = entry[0];
      var icon = entry[1];
      var count = tickets[type] || 0;
      var chip = el('span', { className: 'ticket-chip ticket-' + type }, [
        el('span', { className: 'ticket-icon' }, icon),
        el('span', { className: 'ticket-count' }, '' + count)
      ]);
      bar.appendChild(chip);
    });
  };

  UIController.prototype._updatePawnIndicator = function (state) {
    var indicator = this.$pawnIndicator;
    if (!indicator) return;

    var current = state.players[state.currentPlayerIndex];
    if (!current.pawns || current.pawns.length <= 1 || state.currentPlayerIndex === 0) {
      indicator.style.display = 'none';
      return;
    }

    indicator.style.display = '';
    indicator.innerHTML = '';

    var self = this;
    var color = DETECTIVE_COLORS[state.currentPlayerIndex - 1] || { color: '#888' };

    current.pawns.forEach(function (pawn, idx) {
      var btn = el('button', {
        className: 'pawn-select-btn' + (idx === self._activePawnIndex ? ' active' : ''),
        style: {
          minWidth: '48px', minHeight: '48px',
          backgroundColor: idx === self._activePawnIndex ? color.color : 'transparent',
          color: idx === self._activePawnIndex ? '#fff' : color.color,
          border: '2px solid ' + color.color
        },
        onclick: function () {
          self._activePawnIndex = idx;
          self.updateBoard();
          self._updateBottomPanel();
        }
      }, 'Pawn ' + (idx + 1) + ' (#' + pawn.position + ')');
      indicator.appendChild(btn);
    });
  };

  // ── Travel log panel ────────────────────────────────────────────────────
  UIController.prototype._toggleTravelLog = function () {
    this._travelLogOpen = !this._travelLogOpen;
    if (this.$travelLogPanel) {
      this.$travelLogPanel.classList.toggle('open', this._travelLogOpen);
    }
    if (this._travelLogOpen) {
      this._renderTravelLog();
    }
  };

  UIController.prototype._renderTravelLog = function () {
    var list = this.$travelLogList;
    if (!list || !this.engine) return;
    list.innerHTML = '';

    var state = this.engine.getState();
    var log = state.travelLog || [];

    if (log.length === 0) {
      var empty = el('div', { className: 'travel-log-empty' }, 'No moves yet');
      list.appendChild(empty);
      return;
    }

    var TICKET_COLORS = {
      taxi: '#EAB308',
      bus: '#3B82F6',
      underground: '#EF4444',
      black: '#1a1a2e',
      boat: '#1a1a2e'
    };

    log.forEach(function (entry, idx) {
      var turnNum = idx + 1;
      var isReveal = REVEAL_TURNS.indexOf(turnNum) !== -1;

      var row = el('div', { className: 'travel-log-row' + (isReveal ? ' reveal' : '') });

      // Turn number
      var turnLabel = el('span', { className: 'travel-log-turn' }, '#' + turnNum);
      row.appendChild(turnLabel);

      // Ticket pill
      var ticketType = entry.ticket || 'taxi';
      var pill = el('span', {
        className: 'travel-log-pill',
        style: { backgroundColor: TICKET_COLORS[ticketType] || '#888', color: '#fff' }
      }, ticketType.charAt(0).toUpperCase() + ticketType.slice(1));
      row.appendChild(pill);

      // Position — only on reveal turns
      if (isReveal && entry.position != null) {
        var pos = el('span', { className: 'travel-log-position' }, '→ #' + entry.position);
        row.appendChild(pos);
      } else {
        var hidden = el('span', { className: 'travel-log-position hidden' }, '???');
        row.appendChild(hidden);
      }

      list.appendChild(row);
    });

    // Scroll to bottom
    list.scrollTop = list.scrollHeight;
  };

  // ── Reveal overlay ──────────────────────────────────────────────────────
  UIController.prototype.showReveal = function (nodeId, callback) {
    var overlay = this.$revealOverlay;
    if (!overlay) {
      if (callback) callback();
      return;
    }

    overlay.innerHTML = '';
    var inner = el('div', { className: 'reveal-inner' }, [
      el('div', { className: 'reveal-icon' }, '🔍'),
      el('div', { className: 'reveal-text' }, 'Mr. X Spotted at #' + nodeId + '!')
    ]);
    overlay.appendChild(inner);
    overlay.classList.add('visible');

    // Auto-dismiss after 3s
    setTimeout(function () {
      overlay.classList.remove('visible');
      if (callback) callback();
    }, 3000);

    // Also allow tap to dismiss
    var dismissed = false;
    overlay.addEventListener('click', function dismiss() {
      if (dismissed) return;
      dismissed = true;
      overlay.classList.remove('visible');
      overlay.removeEventListener('click', dismiss);
      if (callback) callback();
    });
  };

  // ── Game over ───────────────────────────────────────────────────────────
  UIController.prototype.showGameOver = function (winner, reason) {
    if (this.$winnerTitle) {
      this.$winnerTitle.textContent = winner === 'mrx' ? 'Mr. X Wins!' : 'Detectives Win!';
    }
    if (this.$winnerReason) {
      this.$winnerReason.textContent = reason || '';
    }
    this.showScreen('gameover');
  };

  // ── Save / Load ─────────────────────────────────────────────────────────
  UIController.prototype.saveGame = function () {
    if (!this.engine) return;
    try {
      var data = this.engine.getState();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      // localStorage quota or serialization error — silently skip
    }
  };

  UIController.prototype.loadGame = function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        this.showScreen('welcome');
        return;
      }
      var data = JSON.parse(raw);
      this.engine = new window.GameEngine();
      this.engine.loadState(data);
      this.renderer = new window.BoardRenderer('board-container');
      this.renderer.render();
      this.renderer.onNodeClick(this._onNodeClick.bind(this));
      this._activePawnIndex = 0;
      this.startTurn();
    } catch (e) {
      // Corrupted save — remove and start fresh
      localStorage.removeItem(SAVE_KEY);
      this.showScreen('welcome');
    }
  };

  // ── Rules modal ─────────────────────────────────────────────────────────
  UIController.prototype.showRules = function () {
    if (!this.$rulesModal) return;
    this.$rulesModal.classList.remove('hidden');
  };

  UIController.prototype._hideRules = function () {
    if (this.$rulesModal) {
      this.$rulesModal.classList.add('hidden');
    }
  };

  UIController.prototype._populateRulesContent = function () {
    var body = this.$rulesModal.querySelector('.rules-body');
    if (!body || body.childNodes.length > 0) return; // Already populated

    var sections = [
      {
        title: 'Overview',
        text: 'Scotland Yard is a game of cat and mouse. One player is Mr. X, trying to evade the detectives. ' +
              'The other players control detectives trying to catch Mr. X by landing on the same station.'
      },
      {
        title: 'Movement',
        text: 'Players move by spending a transport ticket (taxi, bus, or underground) to travel along a matching route. ' +
              'Mr. X also has black tickets that work on any route, and double-move tokens for two moves in one turn.'
      },
      {
        title: 'Mr. X',
        text: 'Mr. X moves secretly. The detectives only see which ticket was used, not the destination. ' +
              'Mr. X\'s position is revealed on turns 3, 8, 13, 18, and 24.'
      },
      {
        title: 'Winning',
        text: 'Detectives win by landing on Mr. X\'s station. Mr. X wins by surviving all ' + MAX_TURNS + ' turns ' +
              'or if all detectives run out of valid moves.'
      },
      {
        title: 'Tickets',
        text: 'Detectives start with: ' + DETECTIVE_TICKETS.taxi + ' taxi, ' +
              DETECTIVE_TICKETS.bus + ' bus, ' + DETECTIVE_TICKETS.underground + ' underground. ' +
              'Mr. X starts with: ' + MRX_STARTING_TICKETS.taxi + ' taxi, ' +
              MRX_STARTING_TICKETS.bus + ' bus, ' + MRX_STARTING_TICKETS.underground + ' underground, ' +
              MRX_STARTING_TICKETS.black + ' black, ' + MRX_STARTING_TICKETS.double + ' double move.'
      }
    ];

    sections.forEach(function (sec) {
      body.appendChild(el('h3', null, sec.title));
      body.appendChild(el('p', null, sec.text));
    });
  };

  // ── Expose globally ─────────────────────────────────────────────────────
  window.UIController = UIController;
})();

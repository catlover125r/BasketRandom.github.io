"use strict";

// ═══════════════════════════════════════════════════════════════
//  Basket Random — Lobby + Online Multiplayer
//  Controls: Player 1 = W key  |  Player 2 = ↑ Arrow key
// ═══════════════════════════════════════════════════════════════

const Lobby = (() => {

  // ── State ─────────────────────────────────────────────────────
  let peer        = null;   // PeerJS peer (host or joiner)
  let dataConn    = null;   // WebRTC data channel
  let mediaConn   = null;   // WebRTC media (canvas stream)
  let roomId      = null;   // current room ID
  let role        = null;   // 'host' | 'joiner' | 'local'
  let firebaseDB  = null;   // Firebase database instance
  let fbReady     = false;  // Firebase loaded?
  let gameLoaded  = false;  // Game scripts injected?

  const P1_KEY = 87;  // W
  const P2_KEY = 38;  // ↑ Arrow

  // ── Screen navigation ─────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.lscreen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('ls-' + name);
    if (el) el.classList.add('active');
  }

  // ── Firebase helpers ──────────────────────────────────────────
  function initFirebase() {
    if (fbReady) return true;
    try {
      if (!window.firebase) return false;
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      firebaseDB = firebase.database();
      fbReady = true;
      return true;
    } catch (e) {
      console.error('Firebase init failed:', e);
      return false;
    }
  }

  function fbCreateRoom(rId) {
    return firebaseDB.ref('rooms/' + rId).set({
      id:      rId,
      status:  'waiting',
      created: Date.now(),
    }).then(() => {
      // Auto-delete this room if the host's Firebase connection drops
      firebaseDB.ref('rooms/' + rId).onDisconnect().remove();
    });
  }

  function fbDeleteRoom(rId) {
    return firebaseDB.ref('rooms/' + rId).remove();
  }

  function fbUpdateRoomStatus(rId, status) {
    return firebaseDB.ref('rooms/' + rId + '/status').set(status);
  }

  function fbListenRooms(callback) {
    const ref = firebaseDB.ref('rooms').orderByChild('created');
    const handler = ref.on('value', snap => {
      const rooms = [];
      snap.forEach(child => rooms.push(child.val()));
      callback(rooms);
    });
    return { ref, handler };
  }

  function fbUnlistenRooms(listener) {
    if (listener) listener.ref.off('value', listener.handler);
  }

  // ── Room ID generator ─────────────────────────────────────────
  function makeRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  // ── Load game scripts (lazy) ──────────────────────────────────
  function loadGame() {
    if (gameLoaded) return Promise.resolve();
    gameLoaded = true;
    return new Promise((resolve, reject) => {
      const srcs = [
        'box2d.wasm.js',
        'scripts/supportcheck.js',
        'scripts/offlineclient.js',
        'scripts/main.f.js',
        'scripts/register-sw.js',
      ];
      let i = 0;
      function next() {
        if (i >= srcs.length) { resolve(); return; }
        const s = document.createElement('script');
        s.src = srcs[i++];
        s.onload = next;
        s.onerror = () => { console.warn('Script load error:', s.src); next(); };
        document.body.appendChild(s);
      }
      next();
    });
  }

  // ── Find the game canvas (polls until present) ────────────────
  function waitForCanvas(cb, tries) {
    tries = tries || 0;
    const c = document.querySelector('canvas');
    if (c) { cb(c); return; }
    if (tries > 60) { console.warn('Canvas not found after 12 s'); return; }
    setTimeout(() => waitForCanvas(cb, tries + 1), 200);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API — called from HTML onclick attributes
  // ═══════════════════════════════════════════════════════════════

  // ── 1-Player / One Computer ───────────────────────────────────
  function startLocal() {
    role = 'local';
    hideLobby();
    loadGame();
  }

  // ── Show 2-player choice ──────────────────────────────────────
  function show2PChoice() {
    showScreen('2p-choice');
  }

  // ── Show online options ───────────────────────────────────────
  function showOnlineOptions() {
    if (!initFirebase()) {
      alert('Firebase is not configured yet.\nOpen firebase-config.js and paste your project credentials.');
      return;
    }
    showScreen('online');
  }

  // ── Create Room ───────────────────────────────────────────────
  function createRoom() {
    if (!initFirebase()) return;

    roomId = makeRoomId();
    role   = 'host';

    document.getElementById('lobby-room-code').textContent = roomId;
    document.getElementById('create-status-text').textContent =
      'Your room is live — waiting for a friend to join…';
    showScreen('create-room');

    // Use deterministic peer ID so joiner can connect after page transition
    const peerId = 'br-' + roomId;
    peer = new Peer(peerId, { debug: 0 });

    peer.on('open', () => {
      fbCreateRoom(roomId).catch(console.error);
    });

    // Joiner's first touch comes in as a data connection from the lobby
    peer.on('connection', conn => {
      dataConn = conn;
      conn.on('open', () => {
        document.getElementById('create-status-text').textContent =
          'Player 2 connected! Starting…';
        fbUpdateRoomStatus(roomId, 'playing').catch(() => {});
        setTimeout(startAsHost, 700);
      });
    });

    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        // collision — retry with new id
        peer.destroy();
        peer = null;
        createRoom();
      } else {
        console.error('Peer error:', err);
      }
    });
  }

  function cancelRoom() {
    if (roomId) fbDeleteRoom(roomId).catch(() => {});
    if (peer)   { peer.destroy(); peer = null; }
    roomId = null;
    showScreen('online');
  }

  // ── Join Room (show list) ─────────────────────────────────────
  let roomsListener = null;

  function showRoomList() {
    if (!initFirebase()) return;
    showScreen('room-list');
    loadRoomList();
  }

  function loadRoomList() {
    const container = document.getElementById('rooms-list');
    container.innerHTML = '<div class="rooms-empty">Loading rooms…</div>';

    if (roomsListener) {
      fbUnlistenRooms(roomsListener);
      roomsListener = null;
    }

    roomsListener = fbListenRooms(rooms => {
      const waiting = rooms.filter(r => r.status === 'waiting');
      if (waiting.length === 0) {
        container.innerHTML =
          '<div class="rooms-empty">No rooms open right now.<br>Be the first — create one!</div>';
        return;
      }
      container.innerHTML = waiting.map(r => `
        <div class="room-row" onclick="Lobby.joinRoom('${r.id}')">
          <div>
            <div class="room-row-name">Room ${r.id}</div>
            <div class="room-row-sub">Waiting for player 2</div>
          </div>
          <button class="join-pill">JOIN</button>
        </div>
      `).join('');
    });
  }

  function joinRoom(rId) {
    fbUnlistenRooms(roomsListener);
    roomsListener = null;

    roomId = rId;
    role   = 'joiner';

    document.getElementById('connect-status-text').textContent =
      'Connecting to host…';
    showScreen('connecting');

    peer = new Peer({ debug: 0 });

    peer.on('open', () => {
      const hostPeerId = 'br-' + rId;
      dataConn = peer.connect(hostPeerId, { reliable: true });

      dataConn.on('open', () => {
        document.getElementById('connect-status-text').textContent =
          'Connected! Waiting for game to start…';
        startAsJoiner();
      });

      dataConn.on('error', () => {
        document.getElementById('connect-status-text').textContent =
          'Could not reach the host. They may have left.';
      });
    });

    peer.on('call', call => {
      mediaConn = call;
      call.answer();
      call.on('stream', stream => {
        const video = document.getElementById('joiner-video');
        video.srcObject = stream;
        video.play();
        video.style.display = 'block';
        document.getElementById('joiner-waiting').style.display = 'none';
      });
    });

    peer.on('error', err => {
      document.getElementById('connect-status-text').textContent =
        'Connection error: ' + err.type + '. Try another room.';
    });

    // Timeout
    setTimeout(() => {
      const el = document.getElementById('connect-status-text');
      if (el && el.textContent.includes('Connecting')) {
        el.textContent = 'Timed out. Please try again.';
      }
    }, 12000);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Game start helpers
  // ═══════════════════════════════════════════════════════════════

  function hideLobby() {
    const overlay = document.getElementById('lobby-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function startAsHost() {
    hideLobby();

    // Show "waiting for joiner video connection" overlay
    const hostOverlay = document.getElementById('host-overlay');
    if (hostOverlay) {
      hostOverlay.classList.add('show');
      hostOverlay.querySelector('.hw-title').textContent =
        'Player 2 is connecting…';
    }

    // Load game first
    loadGame().then(() => {
      // Once canvas exists, capture + stream it
      waitForCanvas(canvas => {
        if (hostOverlay) {
          hostOverlay.querySelector('.hw-title').textContent =
            'Game ready! Player 2 joining…';
        }

        streamCanvasToJoiner(canvas);

        // Receive joiner's key events and dispatch them locally
        dataConn.on('data', msg => {
          if (msg.type === 'kd' || msg.type === 'ku') {
            const evType = msg.type === 'kd' ? 'keydown' : 'keyup';
            document.dispatchEvent(
              new KeyboardEvent(evType, {
                keyCode: msg.kc, which: msg.kc,
                key: msg.k, bubbles: true, cancelable: true,
              })
            );
          } else if (msg.type === 'ready') {
            // Joiner received the stream — hide our waiting overlay
            if (hostOverlay) hostOverlay.classList.remove('show');
          }
        });

        // Block the host's own P2 key (↑) from triggering locally
        document.addEventListener('keydown', e => {
          if (e.keyCode === P2_KEY) e.stopImmediatePropagation();
        }, true);
        document.addEventListener('keyup', e => {
          if (e.keyCode === P2_KEY) e.stopImmediatePropagation();
        }, true);
      });
    });
  }

  function streamCanvasToJoiner(canvas) {
    let stream;
    try {
      stream = canvas.captureStream(30);
    } catch (e) {
      console.error('captureStream failed:', e);
      return;
    }
    if (!peer || !dataConn) return;
    mediaConn = peer.call(dataConn.peer, stream);
  }

  function startAsJoiner() {
    hideLobby();

    const joinerUI = document.getElementById('joiner-ui');
    if (joinerUI) joinerUI.classList.add('show');

    // Forward joiner's P2 key (↑ Arrow) to host
    document.addEventListener('keydown', e => {
      if (e.keyCode === P2_KEY) {
        e.preventDefault();
        if (dataConn && dataConn.open) {
          dataConn.send({ type: 'kd', kc: e.keyCode, k: e.key });
        }
      }
    });
    document.addEventListener('keyup', e => {
      if (e.keyCode === P2_KEY) {
        if (dataConn && dataConn.open) {
          dataConn.send({ type: 'ku', kc: e.keyCode, k: e.key });
        }
      }
    });

    // Also support mobile tap on the joiner screen → send P2 jump
    document.addEventListener('touchstart', e => {
      e.preventDefault();
      if (dataConn && dataConn.open) {
        dataConn.send({ type: 'kd', kc: P2_KEY, k: 'ArrowUp' });
      }
    }, { passive: false });
    document.addEventListener('touchend', e => {
      if (dataConn && dataConn.open) {
        dataConn.send({ type: 'ku', kc: P2_KEY, k: 'ArrowUp' });
      }
    });
  }

  // ── Clean up on page unload ───────────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (role === 'host' && roomId) {
      fbDeleteRoom(roomId).catch(() => {});
    }
    if (peer) peer.destroy();
  });

  // ── Public API ────────────────────────────────────────────────
  return {
    showScreen,
    show2PChoice,
    showOnlineOptions,
    startLocal,
    createRoom,
    cancelRoom,
    showRoomList,
    loadRoomList,
    joinRoom,
  };

})();

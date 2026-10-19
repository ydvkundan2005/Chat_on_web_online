import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
  import { getDatabase, ref, get, set, onValue, off, update, push, onChildAdded, remove } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

  // your firebase config (unchanged)
  const firebaseConfig = {
    apiKey: "AIzaSyA9pmgthHuuMCE5zq8VLlk8jvgjQjfESWU",
    authDomain: "online-web-chat-22e51.firebaseapp.com",
    databaseURL: "https://online-web-chat-22e51-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "online-web-chat-22e51",
    storageBucket: "online-web-chat-22e51.appspot.com",
    messagingSenderId: "389702378019",
    appId: "1:389702378019:web:b53f8d6621c47f8d2c8796",
    measurementId: "G-M7SXNWGNRQ"
  };

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);

  // existing app variables
  let currentUserId = "";
  let currentChatFriend = "";
  let friendsListener = null;
  let messagesListener = null;

  // calling variables
  let pc = null;
  let localStream = null;
  let callType = null; // 'audio' or 'video'
  const pcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  // call tracking
  let currentCallId = null;
  let currentCallPeer = null; // who we're in call with (or ringing)
  // keep unsubscribe functions for listeners so we can reliably detach
  let incomingUnsub = null;
  let answerUnsub = null;
  let remoteCandidatesUnsub = null;
  let callStatusUnsub = null;

  // caller timeouts map { callId: timeoutHandle }
  const callTimeouts = {};

  // UI elements
  const callBar = document.getElementById('callBar');
  const audioCallHalf = document.getElementById('audioCallHalf');
  const videoCallHalf = document.getElementById('videoCallHalf');
  const callPreview = document.getElementById('callPreview');
  const localVideoEl = document.getElementById('callPreviewVideoLocal');
  const remoteVideoEl = document.getElementById('callPreviewVideoRemote');
  const localAudioEl = document.getElementById('callPreviewAudioLocal');
  const remoteAudioEl = document.getElementById('callPreviewAudioRemote');
  const hangupCallBtn = document.getElementById('hangupCallBtn');
  const callOverlay = document.getElementById('callOverlay');
  const muteCallBtn = document.getElementById('muteCallBtn');
  const speakerCallBtn = document.getElementById('speakerCallBtn');
  let microphoneMuted = false;
  let speakerEnabled = true;
  const incomingModal = document.getElementById('incomingModal');
  const incomingText = document.getElementById('incomingText');
  const acceptCallBtn = document.getElementById('acceptCallBtn');
  const rejectCallBtn = document.getElementById('rejectCallBtn');

  /* ------------------ small helpers ------------------ */
  function safeClearTimeout(callId) {
    if (!callId) return;
    const h = callTimeouts[callId];
    if (h) { clearTimeout(h); delete callTimeouts[callId]; }
  }

  function safeUnsub(fn) {
    try { if (typeof fn === 'function') fn(); } catch(e){}
  }

  async function setCallState(userId, stateObj) {
    try {
      await set(ref(db, `callState/${userId}`), { ...stateObj, updated: Date.now() });
    } catch (e) {
      console.warn('setCallState err', e);
    }
  }

  async function getCallState(userId) {
    try {
      const snap = await get(ref(db, `callState/${userId}`));
      return snap.exists() ? snap.val() : null;
    } catch (e) {
      return null;
    }
  }

  // isUserBusy now accepts optional ignoreCallId — ignores that callId while checking current calls.
  async function isUserBusy(userId, ignoreCallId = null) {
    try {
      const cs = await getCallState(userId);
      if (cs && cs.status && cs.status !== 'idle') {
        // if the callState references the call we're intentionally ignoring, treat as not busy
        if (!(ignoreCallId && cs.callId && cs.callId === ignoreCallId)) return true;
      }
      // also check calls entries if any active call references user (excluding ignoreCallId)
      const callsSnap = await get(ref(db, 'calls'));
      if (!callsSnap.exists()) return false;
      const calls = callsSnap.val();
      for (const k in calls) {
        if (!Object.prototype.hasOwnProperty.call(calls, k)) continue;
        if (ignoreCallId && k === ignoreCallId) continue; // ignore the incoming call itself
        const c = calls[k];
        if (!c) continue;
        if ((c.caller === userId || c.callee === userId) && (c.status === 'ringing' || c.status === 'connected' || c.status === 'calling')) {
          return true;
        }
      }
      return false;
    } catch(e) {
      console.warn('isUserBusy err', e);
      return false;
    }
  }

  /* ------------------ App logic (kept same) ------------------ */
  function showSection(id) {
    ["landing", "nicknamePage", "successPage", "loginPage", "chatPage"].forEach(sid => {
      document.getElementById(sid).style.display = sid === id ? "block" : "none";
    });
  }
  window.showLanding = () => showSection("landing");
  window.showNicknamePage = () => {
    showSection("nicknamePage");
    document.getElementById("nicknameInput").value = "";
    document.getElementById("loading").style.display = "none";
    document.getElementById("generatedDetails").style.display = "none";
    document.getElementById("generatedId").value = "";
    document.getElementById("createPassword").value = "";
  };
  window.showLoginPage = () => {
    showSection("loginPage");
    document.getElementById("loginId").value = "";
    document.getElementById("loginPassword").value = "";
  };

  window.generateUserId = () => {
    const nickname = document.getElementById("nicknameInput").value.trim();
    if (!nickname) return alert("Please enter your nickname");
    document.getElementById("loading").style.display = "block";
    const firstLetter = nickname[0].toLowerCase();
    const generateId = () => firstLetter + Math.floor(100 + Math.random() * 900);
    const checkAndGenerateUniqueId = async () => {
      let id = generateId();
      let snap = await get(ref(db, "users/" + id));
      while (snap.exists()) {
        id = generateId();
        snap = await get(ref(db, "users/" + id));
      }
      return id;
    };
    checkAndGenerateUniqueId().then(id => {
      setTimeout(() => {
        document.getElementById("loading").style.display = "none";
        document.getElementById("generatedDetails").style.display = "block";
        document.getElementById("generatedId").value = id;
      }, 700);
    });
  };

  window.finalizeAccount = async () => {
    const id = document.getElementById("generatedId").value.trim();
    const password = document.getElementById("createPassword").value;
    const nickname = document.getElementById("nicknameInput").value.trim();
    if (!password) return alert("Please enter a password");
    const userRef = ref(db, "users/" + id);
    const snap = await get(userRef);
    if (snap.exists()) { alert("ID already exists, try generating again"); return; }
    await set(userRef, { password, nickname });
    showSection("successPage");
  };

  window.loginUser = async () => {
    const id = document.getElementById("loginId").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!id || !password) return alert("Enter ID and password");
    const userRef = ref(db, "users/" + id);
    const snap = await get(userRef);
    if (!snap.exists()) return alert("User ID not found");
    const userData = snap.val();
    if (userData.password !== password) return alert("Password incorrect");
    currentUserId = id;
    showSection("chatPage");
    document.getElementById("friendList").style.display = "block";
    document.getElementById("chatView").style.display = "none";
    loadFriends();
    // start a persistent incoming listener for this user
    startIncomingListener();
    // ensure callState exists
    try { await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
  };

  /* ------------------ Friends & messages (kept same) ------------------ */

  window.toggleAddFriendSection = () => {
    const sec = document.getElementById("addFriendSection");
    sec.style.display = sec.style.display === "none" ? "block" : "none";
  };

  window.addFriend = async () => {
    const friendId = document.getElementById("searchFriendId").value.trim();
    if (!friendId || friendId === currentUserId) return alert("Invalid Friend ID");
    const friendRef = ref(db, "users/" + friendId);
    const snap = await get(friendRef);
    if (!snap.exists()) return alert("Friend not found");
    await set(ref(db, `friends/${currentUserId}/${friendId}`), true);
    await set(ref(db, `friends/${friendId}/${currentUserId}`), true);
    alert("Friend added!");
    document.getElementById("searchFriendId").value = "";
    document.getElementById("addFriendSection").style.display = "none";
    loadFriends();
  };

function loadFriends() {
    const friendsRef = ref(db, `friends/${currentUserId}`);
    if (friendsListener) { off(friendsRef); friendsListener = null; }
    friendsListener = onValue(friendsRef, async snapshot => {
      const friendListDiv = document.getElementById("friendList");
      friendListDiv.innerHTML = "";
      const friends = snapshot.val();
      if (!friends) { friendListDiv.innerHTML = "<p>No friends yet. Add some!</p>"; return; }
      for (const friendId in friends) {
        const friendSnap = await get(ref(db, `users/${friendId}`));
        const friendName = friendSnap.exists() ? friendSnap.val().nickname : friendId;
        const div = document.createElement('div');
        div.textContent = `${friendName} (${friendId})`;
        div.onclick = () => openChat(friendId, friendName);
        friendListDiv.appendChild(div);
      }
    });
  }

  window.openChat = (friendId, friendName) => {
    currentChatFriend = friendId;
    document.getElementById("chatWith").textContent = `${friendName} (${friendId})`;
    document.getElementById("chatView").style.display = "block";
    document.getElementById("friendList").style.display = "none";
    document.getElementById("chatMessages").innerHTML = "";
    listenMessages();
  };

  // ensure leaving the chat cancels active call (caller/callee)
  window.backToFriendList = async () => {
    // if a call exists (ringing or connected), cancel/hang it for both sides
    if (currentCallId) {
      try { await hangupCall(); } catch(e){ /* ignore */ }
    }
    currentChatFriend = "";
    document.getElementById("chatView").style.display = "none";
    document.getElementById("friendList").style.display = "block";
  };

  function listenMessages() {
    if (messagesListener) { off(ref(db, 'messages/' + currentUserId + '_' + currentChatFriend)); messagesListener = null; }
    const messagesRef1 = ref(db, 'messages/' + currentUserId + '_' + currentChatFriend);
    const messagesRef2 = ref(db, 'messages/' + currentChatFriend + '_' + currentUserId);
    let combinedMessages = {};
    const updateMessages = () => {
      const chatMessagesDiv = document.getElementById("chatMessages");
      chatMessagesDiv.innerHTML = "";
      const sortedKeys = Object.keys(combinedMessages).sort((a,b) => combinedMessages[a].timestamp - combinedMessages[b].timestamp);
      sortedKeys.forEach(key => {
        const msg = combinedMessages[key];
        const div = document.createElement("div");
        div.textContent = msg.message;
        div.className = msg.sender === currentUserId ? "me" : "friend";
        chatMessagesDiv.appendChild(div);
      });
      chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    };
    messagesListener = onValue(messagesRef1, snapshot => {
      const msgs = snapshot.val() || {};
      combinedMessages = {...combinedMessages, ...msgs};
      updateMessages();
    });
    onValue(messagesRef2, snapshot => {
      const msgs = snapshot.val() || {};
      combinedMessages = {...combinedMessages, ...msgs};
      updateMessages();
    });
  }

  window.sendMessage = async () => {
    const msgInput = document.getElementById("messageInput");
    const message = msgInput.value.trim();
    if (!message) return;
    const messagesRef = ref(db, 'messages/' + currentUserId + '_' + currentChatFriend);
    const newMsgKey = push(messagesRef).key;
    await update(ref(db, `messages/${currentUserId}_${currentChatFriend}/${newMsgKey}`), {
      sender: currentUserId,
      receiver: currentChatFriend,
      message,
      timestamp: Date.now()
    });
    msgInput.value = "";
  };

  /* ----------------- CALLING / WebRTC functions (fixed behavior) ----------------- */

  // create RTCPeerConnection and wire handlers
  function createPeerConnection(targetId) {
    pc = new RTCPeerConnection(pcConfig);

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        try { remoteVideoEl.srcObject = stream; } catch(e){}
        try { remoteAudioEl.srcObject = stream; } catch(e){}
      }
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const cand = ev.candidate.toJSON();
      // push under candidates/<targetId>/<currentUserId>
      push(ref(db, `candidates/${targetId}/${currentUserId}`), cand);
    };

    pc.onconnectionstatechange = () => {
      console.log('pc state', pc ? pc.connectionState : 'no-pc');
    };

    return pc;
  }

  // listen for remote ICE candidates for calls targeted to me from a specific peer
  function listenForRemoteCandidates(fromId) {
    // detach previous
    safeUnsub(remoteCandidatesUnsub);
    const candidatesRef = ref(db, `candidates/${currentUserId}/${fromId}`);
    remoteCandidatesUnsub = onChildAdded(candidatesRef, async (snap) => {
      const cand = snap.val();
      if (!cand || !pc) return;
      try { await pc.addIceCandidate(cand); } catch(e){ console.warn('addIce err', e); }
    });
  }

  // helper to attach call status listener
  function attachCallStatusListener(callId) {
    if (!callId) return;
    safeUnsub(callStatusUnsub);
    const callStatusRefLocal = ref(db, `calls/${callId}`);
    callStatusUnsub = onValue(callStatusRefLocal, async (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();
      if (!data || !data.status) return;
      const s = data.status;
      console.log('callStatus changed', callId, s);
      if (s === 'ended' || s === 'cancelled' || s === 'no-answer' || s === 'busy' || s === 'rejected') {
        // cleanup locally and reset callState
        try {
          // ensure remote callState is reset if callee/caller known
          if (data.caller) await setCallState(data.caller, { status: 'idle' });
          if (data.callee) await setCallState(data.callee, { status: 'idle' });
        } catch(e){}
        await localCleanupAfterCall(true);
      } else if (s === 'connected') {
        // remote side accepted -> ensure we're marked in-call
        try { await setCallState(currentUserId, { status: 'in-call', peer: currentCallPeer, callId }); } catch(e){}
        // clear any timeout
        safeClearTimeout(callId);
      }
    });
  }

  // caller starts a call
  async function startCall(media) {
    if (!currentUserId || !currentChatFriend) return alert('Select a friend first');
    callType = media;

    // check single-active-call requirement (caller and callee must be idle)
    try {
      const callerBusy = await isUserBusy(currentUserId);
      if (callerBusy) { alert('Line busy'); return; }
      const calleeBusy = await isUserBusy(currentChatFriend);
      if (calleeBusy) { alert('Line busy'); return; }
    } catch (e) {
      console.warn('busy-check err', e);
    }

    try {
      if (media === 'audio') localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      else localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (e) {
      return alert('Permission required: ' + e.message);
    }

    // show preview area (remain visible until explicit cleanup)
    showPreviewArea(media);

    // create unique call id
    const callId = `${Date.now()}_${currentUserId}_${currentChatFriend}`;
    currentCallId = callId;
    currentCallPeer = currentChatFriend;

    // set caller callState to 'calling' so others see us busy
    try { await setCallState(currentUserId, { status: 'calling', peer: currentChatFriend, callId }); } catch(e){}

    createPeerConnection(currentChatFriend);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // write incoming/<callee> and calls/<callId>
    await set(ref(db, `incoming/${currentChatFriend}`), { from: currentUserId, sdp: offer.sdp, type: offer.type, media: media, timestamp: Date.now(), callId });
    await set(ref(db, `calls/${callId}`), { caller: currentUserId, callee: currentChatFriend, status: 'ringing', timestamp: Date.now(), expiresAt: Date.now() + 15000 });
    // listen for answer
    safeUnsub(answerUnsub);
    const answerRefLocal = ref(db, `answers/${currentUserId}/${currentChatFriend}`);
    answerUnsub = onValue(answerRefLocal, async (snap) => {
      if (!snap.exists()) return;
      const ans = snap.val();
      if (ans && ans.sdp) {
        try {
          await pc.setRemoteDescription({ type: ans.type, sdp: ans.sdp });
        } catch (e) { console.warn('setRemoteDesc error', e); }
      }
    });

    // listen for remote candidates
    listenForRemoteCandidates(currentChatFriend);

    // listen for call status changes
    attachCallStatusListener(callId);

    // set a 15s auto-reject timeout (caller-side guard)
    safeClearTimeout(callId);
    callTimeouts[callId] = setTimeout(async () => {
      try {
        const cSnap = await get(ref(db, `calls/${callId}`));
        if (!cSnap.exists()) return;
        const c = cSnap.val();
        if (c && c.status === 'ringing') {
          try { await update(ref(db, `calls/${callId}`), { status: 'no-answer' }); } catch(e){}
          try { await remove(ref(db, `incoming/${currentChatFriend}`)); } catch(e){}
          try { await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
          try { await setCallState(currentChatFriend, { status: 'idle' }); } catch(e){}
          await localCleanupAfterCall(true);
        }
      } catch (e) { console.warn('call timeout cleanup err', e); }
    }, 15000);
    // UI
    hangupCallBtn.style.display = 'flex';
    callBar.style.display = 'none';
  }

  // incoming listener stays attached after login; do not detach on hangup
  function startIncomingListener() {
    if (!currentUserId) return;
    // detach previous if any
    safeUnsub(incomingUnsub);
    const incomingRefLocal = ref(db, `incoming/${currentUserId}`);
    incomingUnsub = onValue(incomingRefLocal, async (snap) => {
      if (!snap.exists()) {
        incomingModal.style.display = 'none';
        return;
      }
      const offer = snap.val();
      if (!offer || !offer.from) return;

      // if already in a call, auto-reject by removing that incoming (so caller gets cleared)
      if (currentCallId) {
        try { await remove(ref(db, `incoming/${currentUserId}`)); } catch(e){}
        return;
      }

      // IMPORTANT: when checking "busy" for the callee, IGNORE the incoming call itself (offer.callId).
      // This prevents treating the newly-created ringing call (the same call) as a conflict.
      const busy = currentCallId || (await isUserBusy(currentUserId, offer.callId));
      if (busy) {
        try { await update(ref(db, `calls/${offer.callId}`), { status: 'busy' }); } catch(e){}
        try { await remove(ref(db, `incoming/${currentUserId}`)); } catch(e){}
        // reset any callState just in case
        try { await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
        return;
      }

      // mark ourselves as ringing in callState
      try { await setCallState(currentUserId, { status: 'ringing', peer: offer.from, callId: offer.callId }); } catch(e){}

      // show incoming modal with caller info
      const callerId = offer.from;
      const callerSnap = await get(ref(db, `users/${callerId}`));
      const callerName = callerSnap.exists() ? callerSnap.val().nickname : callerId;
      incomingText.innerText = `Incoming ${offer.media || 'audio'} call from ${callerName} (${callerId})`;
      incomingModal.style.display = 'block';

      // accept
      acceptCallBtn.onclick = async () => {
        incomingModal.style.display = 'none';
        callType = offer.media || 'audio';
        currentCallId = offer.callId || `${Date.now()}_${callerId}_${currentUserId}`;
        currentCallPeer = callerId;

        // mark answering
        try { await setCallState(currentUserId, { status: 'answering', peer: callerId, callId: currentCallId }); } catch(e){}

        try {
          if (callType === 'audio') localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          else localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch (e) {
          alert('Need mic/cam permission to answer: ' + e.message);
          try { await remove(ref(db, `incoming/${currentUserId}`)); } catch(e){}
          try { await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
          return;
        }

        // preview (stay visible)
        showPreviewArea(callType);

        // create pc and add local
        createPeerConnection(callerId);
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

        // set remote desc from offer
        try { await pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp }); } catch (e) { console.warn('setRemoteDesc on callee error', e); }

        // create answer and write to answers/<caller>/<callee>
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await set(ref(db, `answers/${callerId}/${currentUserId}`), { sdp: answer.sdp, type: answer.type, timestamp: Date.now(), callId: currentCallId });

        // update call status to connected
        try { await update(ref(db, `calls/${currentCallId}`), { status: 'connected' }); } catch(e){ /* ignore */ }

        // update callState for both sides to in-call
        try { await setCallState(currentUserId, { status: 'in-call', peer: callerId, callId: currentCallId }); } catch(e){}
        try { await setCallState(callerId, { status: 'in-call', peer: currentUserId, callId: currentCallId }); } catch(e){}

        // listen for candidates from caller
        listenForRemoteCandidates(callerId);

        // attach call status listener
        attachCallStatusListener(currentCallId);

        // UI adjustments
        callBar.style.display = 'none';
        hangupCallBtn.style.display = 'flex';
        document.getElementById('chatView').style.display = 'block';

        // clear caller-side timeout if any by marking call connected (callStatus listener handles safeClear)
        safeClearTimeout(currentCallId);
      };

      // reject
      rejectCallBtn.onclick = async () => {
        incomingModal.style.display = 'none';
        try { await update(ref(db, `calls/${offer.callId}`), { status: 'rejected' }); } catch(e){}
        try { await remove(ref(db, `incoming/${currentUserId}`)); } catch(e){}
        try { await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
      };
    });
  }

  // show preview area UI
  function showPreviewArea(media) {
    callPreview.style.display = 'block';
    if (callOverlay) callOverlay.classList.add('active');
    const callTitle = document.getElementById('callPeerName'); if (callTitle) callTitle.textContent = currentCallPeer || 'Calling…';
    const callStatusText = document.getElementById('callStatusText'); if (callStatusText) callStatusText.textContent = 'Connecting…';
    localVideoEl.style.display = 'none';
    remoteVideoEl.style.display = 'none';
    localAudioEl.style.display = 'none';
    remoteAudioEl.style.display = 'none';
    localVideoEl.srcObject = null;
    remoteVideoEl.srcObject = null;
    localAudioEl.srcObject = null;
    remoteAudioEl.srcObject = null;

    if (media === 'video') {
      localVideoEl.style.display = 'inline-block';
      remoteVideoEl.style.display = 'inline-block';
      if (localStream) localVideoEl.srcObject = localStream;
    } else {
      localAudioEl.style.display = 'block';
      remoteAudioEl.style.display = 'block';
      if (localStream) localAudioEl.srcObject = localStream;
    }
  }

  // local cleanup after call ended (removeSignaling true if we should remove signaling nodes)
  async function localCleanupAfterCall(removeSignaling/*true if this side should attempt to remove signaling nodes*/) {
    // clear timeout(s)
    if (currentCallId) { safeClearTimeout(currentCallId); }
    // close pc and stop tracks
    if (pc) { try { pc.close(); } catch(e){} pc = null; }
    if (localStream) { try { localStream.getTracks().forEach(t => t.stop()); } catch(e){} localStream = null; }
    // UI reset
    callPreview.style.display = 'none';
    if (callOverlay) callOverlay.classList.remove('active');
    hangupCallBtn.style.display = 'none';
    callBar.style.display = 'flex';
    incomingModal.style.display = 'none';
    // detach per-call listeners
    safeUnsub(answerUnsub); answerUnsub = null;
    safeUnsub(remoteCandidatesUnsub); remoteCandidatesUnsub = null;
    safeUnsub(callStatusUnsub); callStatusUnsub = null;

    // optionally remove signaling nodes (incoming/answers) to clean DB if requested
    if (removeSignaling && currentCallId) {
      try { await remove(ref(db, `calls/${currentCallId}`)); } catch(e){}
      // remove incoming nodes based on calls object rather than localChatFriend variable
      try {
        const callsnap = await get(ref(db, `calls/${currentCallId}`));
        if (callsnap.exists()) {
          const req = callsnap.val();
          if (req && req.callee) {
            try { await remove(ref(db, `incoming/${req.callee}`)); } catch(e){} // best effort
          } else {
            // fallback
            try { if (currentCallPeer) await remove(ref(db, `incoming/${currentCallPeer}`)); } catch(e){}
          }
        } else {
          // fallback
          try { if (currentCallPeer) await remove(ref(db, `incoming/${currentCallPeer}`)); } catch(e){}
        }
      } catch(e){}
      try { await remove(ref(db, `answers/${currentUserId}/${currentCallPeer}`)); } catch(e){}
      try { await remove(ref(db, `answers/${currentCallPeer}/${currentUserId}`)); } catch(e){}
      try { await remove(ref(db, `candidates/${currentUserId}/${currentCallPeer}`)); } catch(e){}
      try { await remove(ref(db, `candidates/${currentCallPeer}/${currentUserId}`)); } catch(e){}
      // reset callState for both sides
      try { await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
      if (currentCallPeer) try { await setCallState(currentCallPeer, { status: 'idle' }); } catch(e){}
    } else {
      // ensure our callState is idle
      try { await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
    }

    // clear call id after cleanup
    currentCallId = null;
    currentCallPeer = null;
    callType = null;
  }// hangup (user pressed hang button) -> announce ended and cleanup locally
  async function hangupCall() {
    // determine current call status from DB (if any)
    if (!currentCallId) {
      // nothing to hang
      return;
    }
    try {
      const callSnap = await get(ref(db, `calls/${currentCallId}`));
      const callObj = callSnap.exists() ? callSnap.val() : null;
      if (callObj && callObj.status === 'ringing') {
        // caller or callee hung up during ringing -> cancel
        try { await update(ref(db, `calls/${currentCallId}`), { status: 'cancelled' }); } catch(e){}
        // remove incoming for callee if caller did it
        try { await remove(ref(db, `incoming/${callObj.callee}`)); } catch(e){}
        // reset callState for both sides
        try { await setCallState(callObj.caller, { status: 'idle' }); } catch(e){}
        try { await setCallState(callObj.callee, { status: 'idle' }); } catch(e){}
      } else {
        // mark call ended
        try { await update(ref(db, `calls/${currentCallId}`), { status: 'ended' }); } catch(e){}
        // remove incoming node for safety
        if (callObj && callObj.callee) try { await remove(ref(db, `incoming/${callObj.callee}`)); } catch(e){}
      }
    } catch (e) {
      console.warn('hangupCall err', e);
    }

    // cleanup locally and remove signaling nodes for tidiness
    await localCleanupAfterCall(true);
  }

  // hook UI buttons
  audioCallHalf.onclick = () => startCall('audio');
  videoCallHalf.onclick = () => startCall('video');
  const headerAudioCall = document.getElementById('headerAudioCall');
  const headerVideoCall = document.getElementById('headerVideoCall');
  if (headerAudioCall) headerAudioCall.onclick = () => startCall('audio');
  if (headerVideoCall) headerVideoCall.onclick = () => startCall('video');
  hangupCallBtn.onclick = () => hangupCall();
  if (muteCallBtn) muteCallBtn.onclick = () => {
    microphoneMuted = !microphoneMuted;
    if (localStream) localStream.getAudioTracks().forEach(track => { track.enabled = !microphoneMuted; });
    muteCallBtn.classList.toggle('active', microphoneMuted);
    const label = muteCallBtn.querySelector('small'); if (label) label.textContent = microphoneMuted ? 'Unmute' : 'Mute';
  };
  if (speakerCallBtn) speakerCallBtn.onclick = () => {
    speakerEnabled = !speakerEnabled;
    [remoteAudioEl, remoteVideoEl].forEach(el => { if (el) el.muted = !speakerEnabled; });
    speakerCallBtn.classList.toggle('active', !speakerEnabled);
    const label = speakerCallBtn.querySelector('small'); if (label) label.textContent = speakerEnabled ? 'Speaker' : 'Speaker off';
  };
  function setBackHistory() { try { history.pushState({ chatApp: true }, ''); } catch(e){} }
  window.addEventListener('popstate', async () => {
    if (callOverlay && callOverlay.classList.contains('active')) { await hangupCall(); setBackHistory(); return; }
    const chat = document.getElementById('chatView');
    if (chat && getComputedStyle(chat).display !== 'none') { window.backToFriendList(); setBackHistory(); return; }
    const add = document.getElementById('addFriendSection');
    if (add && getComputedStyle(add).display !== 'none') { add.style.display = 'none'; setBackHistory(); return; }
    if (document.getElementById('chatPage') && getComputedStyle(document.getElementById('chatPage')).display !== 'none') { window.showLanding(); setBackHistory(); }
  });
  setBackHistory();

  // cleanup on leaving page
  window.addEventListener('beforeunload', async () => {
    try { if (pc) pc.close(); } catch(e){}
    // If leaving while in a call, mark call ended to notify peer and try to clean up
    if (currentCallId) {
      try { await update(ref(db, `calls/${currentCallId}`), { status: 'ended' }); } catch(e){}
      try { await remove(ref(db, `incoming/${currentCallPeer || currentUserId}`)); } catch(e){}
    }
    // set our callState idle
    try { if (currentUserId) await setCallState(currentUserId, { status: 'idle' }); } catch(e){}
  });

  // initial UI
  showLanding();

  // typing effect
  window.addEventListener("DOMContentLoaded", () => {
    const text = "OnlineWebChat";
    const target = document.getElementById("typingHeading");
    let index = 0;
    function typeChar() {
      if (index < text.length) {
        target.textContent += text.charAt(index);
        index++;
        setTimeout(typeChar, 150);
      }
    }
    typeChar();
  });

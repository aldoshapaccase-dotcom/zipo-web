// app.js — punto de entrada de Zipo
import { supabase } from "./supabase-client.js";

const platformNames = { eggsweb: "EggsWeb", ping: "Ping", zipo: "Zipo" };
const platformBadgeColor = {
  eggsweb: "linear-gradient(160deg,#f5b95a,#c56a1f)",
  ping: "linear-gradient(160deg,#c299ef,#7433b8)",
  zipo: "linear-gradient(160deg,#5fb0ef,#1c72c4)",
};

let currentUser = null;   // { id, username, display_name, platform }
let conversations = [];   // [{ id, otherUser, lastMessage, lastAt }]
let activeConversationId = null;
let messagesChannel = null;

const palette = ["#3e9be8", "#e88f3e", "#8f5fe8", "#e85f9c", "#3ecbaa", "#e8c33e"];
function colorFor(name) { let h = 0; for (const c of name) h += c.charCodeAt(0); return palette[h % palette.length]; }
function initials(name) { return (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
function formatTime(iso) {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

// Dibuja la foto de perfil si existe, o el círculo de iniciales si no.
// sizePx: tamaño en px del avatar en ESE contexto (varía según dónde se use).
function avatarHtml(user, sizePx, extraClass = "") {
  const cls = ("avatar " + extraClass).trim();
  if (user.avatar_url) {
    return `<img src="${user.avatar_url}" class="${cls}" style="width:${sizePx}px;height:${sizePx}px;object-fit:cover;" alt="">`;
  }
  const bg = colorFor(user.display_name || "?");
  return `<div class="${cls}" style="width:${sizePx}px;height:${sizePx}px;background:linear-gradient(180deg, ${bg}, ${bg}bb)">${initials(user.display_name)}</div>`;
}

/* ============================================================
   TEMA — sincronizado entre los 3 selectores (login, header, ajustes)
   ============================================================ */
function applyTheme(t) {
  document.body.setAttribute("data-theme", t);
  document.querySelectorAll(".theme-dot").forEach(d =>
    d.classList.toggle("active", d.dataset.t === t)
  );
}
document.querySelectorAll(".theme-dot").forEach(dot => {
  dot.addEventListener("click", () => applyTheme(dot.dataset.t));
});

/* ============================================================
   NAVEGACIÓN ENTRE VISTAS
   ============================================================ */
function switchView(view) {
  document.querySelectorAll(".view-section").forEach(sec => {
    sec.style.display = sec.id === `view-${view}` ? (view === "messages" ? "flex" : "flex") : "none";
  });
  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("current", link.dataset.view === view);
  });
  if (view === "settings") renderSettings();
}
document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    switchView(link.dataset.view);
  });
});

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */
let mode = "login";
let selectedPlatform = null;

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    mode = tab.dataset.mode;
    const isSignup = mode === "signup";
    document.getElementById("platformField").style.display = isSignup ? "block" : "none";
    document.getElementById("usernameField").style.display = isSignup ? "block" : "none";
    document.getElementById("authSubmit").textContent = isSignup ? "Crear cuenta" : "Entrar";
    document.getElementById("authError").classList.remove("show");
  });
});

document.querySelectorAll(".platform-option").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".platform-option").forEach(o => o.classList.remove("selected"));
    opt.classList.add("selected");
    selectedPlatform = opt.dataset.p;
  });
});

function showAuthError(msg, isSuccess = false) {
  const box = document.getElementById("authError");
  box.textContent = msg;
  box.style.background = isSuccess ? "#e8f7ec" : "";
  box.style.color = isSuccess ? "#1e7a34" : "";
  box.style.borderColor = isSuccess ? "#bfe6c8" : "";
  box.classList.add("show");
}

function traducirError(msg) {
  if (msg.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("already registered")) return "Ya existe una cuenta con ese correo.";
  if (msg.includes("Password should be")) return "La contraseña debe tener al menos 6 caracteres.";
  if (msg.includes("duplicate key") && msg.includes("username")) return "Ese nombre de usuario ya está en uso.";
  return msg;
}

function isValidUsername(u) {
  return /^[a-z0-9_]{3,20}$/i.test(u);
}

document.getElementById("authSubmit").addEventListener("click", async () => {
  const submitBtn = document.getElementById("authSubmit");
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  document.getElementById("authError").classList.remove("show");

  if (!email || !password) { showAuthError("Completa correo y contraseña."); return; }

  if (mode === "signup") {
    const username = document.getElementById("authUsername").value.trim();
    if (!selectedPlatform) { showAuthError("Elige si eres de EggsWeb o de Ping."); return; }
    if (!isValidUsername(username)) {
      showAuthError("El usuario debe tener 3-20 caracteres: letras, números o _.");
      return;
    }

    submitBtn.disabled = true;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { platform: selectedPlatform, username, display_name: username },
      },
    });
    submitBtn.disabled = false;

    if (error) { showAuthError(traducirError(error.message)); return; }

    // Respaldo: si el trigger de la base de datos no creó el perfil
    // (por permisos, orden de ejecución, etc.), lo creamos aquí mismo.
    // "upsert" no falla si el trigger ya lo había creado — solo lo confirma.
    if (data.user) {
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: data.user.id,
        username,
        display_name: username,
        platform: selectedPlatform,
      });
      if (profileError) {
        console.error("No se pudo crear el perfil de respaldo:", profileError);
        showAuthError(
          profileError.message.includes("duplicate")
            ? "Ese nombre de usuario ya está en uso."
            : "Cuenta creada, pero hubo un problema guardando tu perfil. Contacta soporte."
        );
        return;
      }
    }

    if (!data.session) {
      showAuthError("Cuenta creada. Revisa tu correo para confirmarla antes de entrar.", true);
      return;
    }
    await onLoggedIn();
  } else {
    submitBtn.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    submitBtn.disabled = false;
    if (error) { showAuthError(traducirError(error.message)); return; }
    await onLoggedIn();
  }
});

async function onLoggedIn() {
  const { data: { user } } = await supabase.auth.getUser();
  let { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // Cuenta antigua sin perfil (creada antes de tener el trigger/política
  // bien configurados): la reparamos aquí mismo, usando lo que haya en
  // los metadatos del usuario o, si no hay nada, valores por defecto.
  if (!error && !profile) {
    const meta = user.user_metadata || {};
    const fallbackUsername = meta.username || (user.email.split("@")[0] + user.id.slice(0, 4));
    const { data: repaired, error: repairError } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        username: fallbackUsername,
        display_name: meta.display_name || meta.username || user.email.split("@")[0],
        platform: meta.platform || "zipo",
      })
      .select("*")
      .single();

    if (repairError) { error = repairError; }
    else { profile = repaired; }
  }

  if (error || !profile) {
    console.error(error);
    showAuthError("No se pudo cargar tu perfil. Intenta de nuevo.");
    return;
  }

  currentUser = profile;

  document.getElementById("authScreen").style.display = "none";
  document.getElementById("appScreen").classList.add("show");

  refreshProfileChip();

  switchView("messages");
  await loadConversations();
  subscribeToMessages();
  initRingChannel();
}

function refreshProfileChip() {
  const holder = document.getElementById("profileAvatarHolder");
  holder.innerHTML = avatarHtml(currentUser, 26, "");
  document.getElementById("profileName").textContent = currentUser.display_name;
  const badge = document.getElementById("profileBadge");
  badge.textContent = platformNames[currentUser.platform];
  badge.style.background = platformBadgeColor[currentUser.platform];
}

async function logout() {
  await supabase.auth.signOut();
  if (messagesChannel) supabase.removeChannel(messagesChannel);
  if (ringChannel) { supabase.removeChannel(ringChannel); ringChannel = null; }
  if (currentCall) endCall(true);
  currentUser = null;
  conversations = [];
  activeConversationId = null;
  document.getElementById("appScreen").classList.remove("show");
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("authEmail").value = "";
  document.getElementById("authPassword").value = "";
}

document.getElementById("profileChip").addEventListener("click", logout);
document.getElementById("settingsLogout").addEventListener("click", logout);

supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) onLoggedIn();
});

/* ============================================================
   VISTA: MENSAJES — conversaciones reales
   ============================================================ */
async function loadConversations() {
  const { data: rows, error } = await supabase
    .from("conversations")
    .select("id, user_a, user_b, created_at")
    .or(`user_a.eq.${currentUser.id},user_b.eq.${currentUser.id}`);

  if (error || !rows) { conversations = []; renderConversationList(); return; }

  const otherIds = rows.map(r => (r.user_a === currentUser.id ? r.user_b : r.user_a));
  let profilesById = {};
  if (otherIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("*")
      .in("id", otherIds);
    (profs || []).forEach(p => { profilesById[p.id] = p; });
  }

  const convIds = rows.map(r => r.id);
  let lastByConv = {};
  if (convIds.length) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("conversation_id, body, sent_at")
      .in("conversation_id", convIds)
      .order("sent_at", { ascending: false });
    (msgs || []).forEach(m => {
      if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m;
    });
  }

  conversations = rows.map(r => {
    const otherId = r.user_a === currentUser.id ? r.user_b : r.user_a;
    const last = lastByConv[r.id];
    return {
      id: r.id,
      otherUser: profilesById[otherId] || { id: otherId, username: "?", display_name: "Usuario", platform: "zipo" },
      lastMessage: last ? last.body : "Todavía no hay mensajes.",
      lastAt: last ? last.sent_at : r.created_at,
    };
  }).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  renderConversationList();
}

function renderConversationList(filterText = "") {
  const wrap = document.getElementById("contacts");
  const emptyMsg = document.getElementById("conversationsEmpty");
  const filtered = conversations.filter(c =>
    c.otherUser.display_name.toLowerCase().includes(filterText.toLowerCase()) ||
    c.otherUser.username.toLowerCase().includes(filterText.toLowerCase())
  );

  wrap.innerHTML = "";
  if (!filtered.length) {
    wrap.appendChild(emptyMsg || document.createElement("div"));
    const el = document.createElement("div");
    el.className = "empty-state";
    el.textContent = conversations.length
      ? "No hay conversaciones que coincidan con tu búsqueda."
      : 'Aún no tienes conversaciones. Ve a "Contactos" para buscar a alguien por su usuario.';
    wrap.innerHTML = "";
    wrap.appendChild(el);
    return;
  }

  filtered.forEach(c => {
    const el = document.createElement("div");
    el.className = "contact" + (c.id === activeConversationId ? " active" : "");
    el.innerHTML = `
      ${avatarHtml(c.otherUser, 38)}
      <div class="contact-meta">
        <div class="contact-name-row">
          <div class="contact-name">${c.otherUser.display_name}</div>
          <span class="plat-tag ${c.otherUser.platform}">${platformNames[c.otherUser.platform]}</span>
        </div>
        <div class="contact-sub">${c.lastMessage}</div>
      </div>
    `;
    el.addEventListener("click", () => openConversation(c.id));
    wrap.appendChild(el);
  });
}

document.getElementById("filterConversations").addEventListener("input", (e) => {
  renderConversationList(e.target.value);
});

async function openConversation(conversationId) {
  activeConversationId = conversationId;
  renderConversationList(document.getElementById("filterConversations").value);

  const conv = conversations.find(c => c.id === conversationId);
  const header = document.getElementById("chatHeader");
  header.innerHTML = `
    ${avatarHtml(conv.otherUser, 34)}
    <div>
      <div class="chat-header-name-row">
        <div class="chat-header-name">${conv.otherUser.display_name}</div>
        <span class="plat-tag ${conv.otherUser.platform}">${platformNames[conv.otherUser.platform]}</span>
      </div>
      <div class="chat-header-status">@${conv.otherUser.username}</div>
    </div>
    <div class="chat-header-actions">
      <button class="call-icon-btn" id="startAudioCallBtn" title="Llamar">📞</button>
      <button class="call-icon-btn" id="startVideoCallBtn" title="Videollamada">🎥</button>
    </div>
  `;
  document.getElementById("startAudioCallBtn").addEventListener("click", () => startCall(conv.otherUser, "audio"));
  document.getElementById("startVideoCallBtn").addEventListener("click", () => startCall(conv.otherUser, "video"));

  document.getElementById("msgInput").disabled = false;
  document.getElementById("sendBtn").disabled = false;

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, sender_id, body, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true });

  renderMessages(msgs || []);
}

function renderMessages(msgs) {
  const box = document.getElementById("messages");
  box.innerHTML = "";
  msgs.forEach(m => {
    const row = document.createElement("div");
    row.className = "msg-row " + (m.sender_id === currentUser.id ? "me" : "them");
    row.innerHTML = `<div class="bubble">${escapeHtml(m.body)}<span class="time">${formatTime(m.sent_at)}</span></div>`;
    box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function sendMessage() {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text || !activeConversationId) return;
  input.value = "";

  const { error } = await supabase.from("messages").insert({
    conversation_id: activeConversationId,
    sender_id: currentUser.id,
    body: text,
  });

  if (error) {
    console.error(error);
    return;
  }
  // La UI se actualiza sola vía Realtime (subscribeToMessages), no hace falta pintar aquí.
}

document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("msgInput").addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });

function subscribeToMessages() {
  if (messagesChannel) supabase.removeChannel(messagesChannel);
  messagesChannel = supabase
    .channel("messages-changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      const m = payload.new;

      // Si es de la conversación abierta, añádelo al chat visible
      if (m.conversation_id === activeConversationId) {
        const box = document.getElementById("messages");
        const row = document.createElement("div");
        row.className = "msg-row " + (m.sender_id === currentUser.id ? "me" : "them");
        row.innerHTML = `<div class="bubble">${escapeHtml(m.body)}<span class="time">${formatTime(m.sent_at)}</span></div>`;
        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
      }

      // Actualiza el preview y el orden de la lista de conversaciones
      const conv = conversations.find(c => c.id === m.conversation_id);
      if (conv) {
        conv.lastMessage = m.body;
        conv.lastAt = m.sent_at;
        conversations.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
        renderConversationList(document.getElementById("filterConversations").value);
      } else {
        // Mensaje de una conversación que no teníamos cargada todavía (nueva)
        loadConversations();
      }
    })
    .subscribe();
}

/* ============================================================
   VISTA: CONTACTOS — búsqueda real por username
   ============================================================ */
let searchDebounce = null;
document.getElementById("userSearchInput").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  searchDebounce = setTimeout(() => searchUsers(q), 300);
});

async function searchUsers(query) {
  const resultsBox = document.getElementById("userSearchResults");
  if (!query) { resultsBox.innerHTML = ""; return; }

  const { data: results, error } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", `%${query}%`)
    .neq("id", currentUser.id)
    .limit(20);

  if (error) { resultsBox.innerHTML = `<div class="search-empty">Error buscando: ${error.message}</div>`; return; }

  if (!results.length) {
    resultsBox.innerHTML = `<div class="search-empty">Nadie con ese usuario todavía.</div>`;
    return;
  }

  resultsBox.innerHTML = "";
  results.forEach(u => {
    const el = document.createElement("div");
    el.className = "user-result";
    el.innerHTML = `
      ${avatarHtml(u, 36)}
      <div class="user-result-meta">
        <div class="user-result-name">${u.display_name} <span class="plat-tag ${u.platform}">${platformNames[u.platform]}</span></div>
        <div class="user-result-username">@${u.username}</div>
      </div>
      <button class="user-result-btn">Escribir</button>
    `;
    el.querySelector("button").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = "Abriendo...";
      await startOrOpenConversation(u);
    });
    resultsBox.appendChild(el);
  });
}

async function startOrOpenConversation(otherUser) {
  // ¿Ya existe una conversación entre estos dos, en cualquier orden?
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .or(
      `and(user_a.eq.${currentUser.id},user_b.eq.${otherUser.id}),` +
      `and(user_a.eq.${otherUser.id},user_b.eq.${currentUser.id})`
    )
    .maybeSingle();

  let conversationId = existing?.id;

  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ user_a: currentUser.id, user_b: otherUser.id })
      .select("id")
      .single();
    if (error) { console.error(error); return; }
    conversationId = created.id;
  }

  await loadConversations();
  switchView("messages");
  openConversation(conversationId);
}

/* ============================================================
   VISTA: AJUSTES + FOTO DE PERFIL
   ============================================================ */
function renderSettings() {
  if (!currentUser) return;
  document.getElementById("settingsAvatarHolder").innerHTML = avatarHtml(currentUser, 52);
  document.getElementById("settingsName").textContent = currentUser.display_name;
  document.getElementById("settingsUsername").textContent = "@" + currentUser.username;
  const tag = document.getElementById("settingsPlatformTag");
  tag.textContent = platformNames[currentUser.platform];
  tag.className = "plat-tag " + currentUser.platform;
}

document.getElementById("avatarFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById("avatarUploadStatus");

  if (file.size > 3 * 1024 * 1024) {
    statusEl.textContent = "La imagen debe pesar menos de 3MB.";
    return;
  }

  statusEl.textContent = "Subiendo foto...";

  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${currentUser.id}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, cacheControl: "3600" });

  if (uploadError) {
    statusEl.textContent = "Error subiendo la foto: " + uploadError.message;
    return;
  }

  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = urlData.publicUrl + "?t=" + Date.now(); // evita que quede la foto vieja en caché

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", currentUser.id);

  if (updateError) {
    statusEl.textContent = "Error guardando la foto: " + updateError.message;
    return;
  }

  currentUser.avatar_url = avatarUrl;
  statusEl.textContent = "¡Foto actualizada!";
  renderSettings();
  refreshProfileChip();
  renderConversationList(document.getElementById("filterConversations").value); // por si tu propio avatar aparece en algún preview

  setTimeout(() => { statusEl.textContent = ""; }, 2500);
});

/* ============================================================
   LLAMADAS DE VOZ / VIDEO — WebRTC + señalización con Supabase Realtime
   ============================================================
   Cómo funciona, en resumen:
   1. Cada usuario, al iniciar sesión, se suscribe a un canal propio
      "calls:<mi_id>" — es su "timbre" personal.
   2. Para llamar a alguien, le mandamos un mensaje por SU canal de
      timbre con la oferta SDP (WebRTC) y un callId único.
   3. Si acepta, ambos se unen a un canal específico de esa llamada
      "call-room:<callId>" para intercambiar la respuesta SDP y los
      candidatos ICE (la info de red que permite conectar los navegadores
      directamente entre sí).
   4. STUN/TURN: usamos el STUN público de Google (gratis, sin cuenta) y
      un TURN de demo público (openrelay.metered.ca) para que la llamada
      funcione incluso si alguno está detrás de un router restrictivo.
      Para producción real se recomienda una cuenta propia de TURN
      (ej. Metered.ca, Twilio) en vez de depender del servidor de demo.
   ============================================================ */

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

let ringChannel = null;       // canal personal donde "me suena el teléfono"
let callRoomChannel = null;   // canal específico de la llamada en curso
let pc = null;                // RTCPeerConnection activa
let localStream = null;
let currentCall = null;       // { callId, otherUser, type, role: 'caller'|'callee' }
let micOn = true;
let camOn = true;

// Se llama una vez, cuando el usuario inicia sesión (ver onLoggedIn)
function initRingChannel() {
  if (ringChannel) supabase.removeChannel(ringChannel);
  ringChannel = supabase.channel(`calls:${currentUser.id}`);
  ringChannel.on("broadcast", { event: "incoming-call" }, ({ payload }) => {
    showIncomingCall(payload);
  });
  ringChannel.subscribe();
}

async function startCall(otherUser, type) {
  if (currentCall) { showCallToast("Ya tienes una llamada en curso."); return; }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === "video" });
  } catch (err) {
    showCallToast("No se pudo acceder al micrófono/cámara. Revisa los permisos del navegador.");
    return;
  }

  const callId = crypto.randomUUID();
  currentCall = { callId, otherUser, type, role: "caller" };

  pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  wireUpPeerConnection();

  callRoomChannel = supabase.channel(`call-room:${callId}`);
  callRoomChannel.on("broadcast", { event: "answer" }, async ({ payload }) => {
    await pc.setRemoteDescription(payload.answer);
    setCallStatus("En llamada");
  });
  callRoomChannel.on("broadcast", { event: "ice-candidate" }, ({ payload }) => {
    if (payload.candidate) pc.addIceCandidate(payload.candidate).catch(() => {});
  });
  callRoomChannel.on("broadcast", { event: "declined" }, () => { showCallToast("Llamada rechazada."); endCall(false); });
  callRoomChannel.on("broadcast", { event: "end" }, () => endCall(false));
  await callRoomChannel.subscribe();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const calleeRing = supabase.channel(`calls:${otherUser.id}`);
  await calleeRing.subscribe();
  calleeRing.send({
    type: "broadcast",
    event: "incoming-call",
    payload: {
      callId, type,
      from: currentUser.id,
      fromName: currentUser.display_name,
      fromAvatar: currentUser.avatar_url || null,
      offer,
    },
  });
  setTimeout(() => supabase.removeChannel(calleeRing), 4000); // ya cumplió su función de "timbre"

  showActiveCallUI(otherUser, type, "Llamando...");
}

function showIncomingCall(payload) {
  if (currentCall) return; // ya está en otra llamada, ignoramos (mejora futura: enviar "busy")

  currentCall = { callId: payload.callId, otherUser: { id: payload.from, display_name: payload.fromName, avatar_url: payload.fromAvatar }, type: payload.type, role: "callee", pendingOffer: payload.offer };

  document.getElementById("incomingCallAvatarHolder").innerHTML = avatarHtml(currentCall.otherUser, 76);
  document.getElementById("incomingCallName").textContent = payload.fromName;
  document.getElementById("incomingCallSub").textContent = (payload.type === "video" ? "Videollamada entrante..." : "Llamada entrante...");
  document.getElementById("incomingCallOverlay").style.display = "flex";
}

document.getElementById("acceptCallBtn").addEventListener("click", async () => {
  document.getElementById("incomingCallOverlay").style.display = "none";
  const { callId, otherUser, type, pendingOffer } = currentCall;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === "video" });
  } catch (err) {
    showCallToast("No se pudo acceder al micrófono/cámara.");
    currentCall = null;
    return;
  }

  pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  wireUpPeerConnection();

  callRoomChannel = supabase.channel(`call-room:${callId}`);
  callRoomChannel.on("broadcast", { event: "ice-candidate" }, ({ payload }) => {
    if (payload.candidate) pc.addIceCandidate(payload.candidate).catch(() => {});
  });
  callRoomChannel.on("broadcast", { event: "end" }, () => endCall(false));
  await callRoomChannel.subscribe();

  await pc.setRemoteDescription(pendingOffer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  callRoomChannel.send({ type: "broadcast", event: "answer", payload: { answer } });

  showActiveCallUI(otherUser, type, "En llamada");
});

document.getElementById("declineCallBtn").addEventListener("click", () => {
  document.getElementById("incomingCallOverlay").style.display = "none";
  if (currentCall) {
    const declineChannel = supabase.channel(`call-room:${currentCall.callId}`);
    declineChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        declineChannel.send({ type: "broadcast", event: "declined", payload: {} });
        setTimeout(() => supabase.removeChannel(declineChannel), 1500);
      }
    });
  }
  currentCall = null;
});

function wireUpPeerConnection() {
  pc.onicecandidate = (e) => {
    if (e.candidate && callRoomChannel) {
      callRoomChannel.send({ type: "broadcast", event: "ice-candidate", payload: { candidate: e.candidate } });
    }
  };
  pc.ontrack = (e) => {
    const remoteVideo = document.getElementById("remoteVideo");
    remoteVideo.srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === "disconnected" || pc.connectionState === "failed")) {
      endCall(false);
    }
  };
}

function showActiveCallUI(otherUser, type, statusText) {
  document.getElementById("activeCallAvatarHolder").innerHTML = avatarHtml(otherUser, 56);
  document.getElementById("activeCallName").textContent = otherUser.display_name;
  setCallStatus(statusText);

  const stage = document.getElementById("callVideoStage");
  stage.classList.toggle("audio-only", type !== "video");

  document.getElementById("localVideo").srcObject = localStream;

  micOn = true; camOn = true;
  document.getElementById("toggleMicBtn").classList.remove("muted");
  document.getElementById("toggleCamBtn").style.display = type === "video" ? "flex" : "none";

  document.getElementById("activeCallOverlay").style.display = "flex";
}

function setCallStatus(text) {
  const el = document.getElementById("activeCallStatus");
  if (el) el.textContent = text;
}

document.getElementById("toggleMicBtn").addEventListener("click", () => {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  document.getElementById("toggleMicBtn").classList.toggle("muted", !micOn);
});

document.getElementById("toggleCamBtn").addEventListener("click", () => {
  if (!localStream) return;
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  document.getElementById("toggleCamBtn").classList.toggle("muted", !camOn);
});

document.getElementById("hangupBtn").addEventListener("click", () => endCall(true));

function endCall(notifyOther) {
  if (notifyOther && callRoomChannel) {
    callRoomChannel.send({ type: "broadcast", event: "end", payload: {} });
  }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (callRoomChannel) { supabase.removeChannel(callRoomChannel); callRoomChannel = null; }

  document.getElementById("remoteVideo").srcObject = null;
  document.getElementById("localVideo").srcObject = null;
  document.getElementById("activeCallOverlay").style.display = "none";
  document.getElementById("incomingCallOverlay").style.display = "none";

  currentCall = null;
}

function showCallToast(msg) {
  // Reutiliza el input de filtro como lugar sencillo de aviso si no hay
  // sistema de toasts propio; lo simple es una alerta del navegador.
  alert(msg);
}

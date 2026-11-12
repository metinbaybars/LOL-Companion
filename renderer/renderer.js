/* global api */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const fix = (x, d = 1) => (x || 0).toFixed(d);
const ROLE_TR = { TOP: 'Üst', JUNGLE: 'Orman', MIDDLE: 'Orta', BOTTOM: 'Nişancı', UTILITY: 'Destek' };
const TIER_TR = {
  IRON: 'Demir', BRONZE: 'Bronz', SILVER: 'Gümüş', GOLD: 'Altın', PLATINUM: 'Platin', EMERALD: 'Zümrüt',
  DIAMOND: 'Elmas', MASTER: 'Ustalık', GRANDMASTER: 'Büyük Ustalık', CHALLENGER: 'Şampiyonluk',
};
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

let dd = { version: null, champsByKey: {}, items: {} };
let champNameById = {};
let settings = {};

// ---------- Yardımcılar ----------
const cdn = (p) => (dd.version ? `https://ddragon.leagueoflegends.com/cdn/${dd.version}/img/${p}` : '');
const splash = (id) => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${encodeURIComponent(id)}_0.jpg`;
const emblem = (tier) => `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${String(tier).toLowerCase()}.png`;
const champName = (id) => champNameById[id] || id;
const champImg = (id, cls = '') => (id
  ? `<img class="${cls}" src="${cdn(`champion/${esc(id)}.png`)}" alt="" title="${esc(champName(id))}">`
  : `<img class="${cls}" alt="">`);
const itemsHtml = (ids) => `<div class="items">${(ids || []).map((id) =>
  id ? `<img src="${cdn(`item/${id}.png`)}" title="${esc(dd.items[id]?.name || id)}">` : '<span class="empty"></span>').join('')}</div>`;
const tierText = (e) => (e ? `${TIER_TR[e.tier] || e.tier}${APEX.includes(e.tier) ? '' : ` ${e.rank}`}` : 'Derecesiz');
const rankText = (e) => (e ? `${tierText(e)} · ${e.leaguePoints ?? e.lp} LP` : 'Derecesiz');
const timeAgo = (ts) => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} sa önce` : `${Math.floor(h / 24)} gün önce`;
};
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
// İstemci başka oyuncuların mağlubiyet sayısını vermez → sadece galibiyet
const winLoss = (e) => (e.losses == null ? `${e.wins} galibiyet`
  : `${e.wins}G ${e.losses}M · ${pct(e.wins / Math.max(1, e.wins + e.losses))}`);
const formHtml = (form) => `<div class="form">${(form || []).map((f) => `<i class="${f}">${f === 'W' ? 'G' : 'M'}</i>`).join('')}</div>`;
const wrClass = (x) => (x == null ? '' : x >= 0.5 ? 'good' : 'bad');
const loadingHtml = (text) => `<div class="empty-state"><div class="spinner"></div><p style="margin-top:14px">${esc(text)}</p></div>`;
const errorHtml = (text) => `<div class="empty-state error-state"><div class="empty-ico">!</div><h3>Bir sorun oluştu</h3><p>${esc(text)}</p></div>`;

// Yüklenemeyen görselleri gizle (CSP satır içi onerror'a izin vermez)
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 6000);
}

// ---------- Sekmeler ----------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
function showView(name) {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.view === name));
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('active', x.id === `view-${name}`));
}

// ---------- Profil ----------
$('#btnMe').addEventListener('click', async () => {
  try {
    const id = await api.myRiotId();
    if (!id) { toast('League istemcisi açık değil.'); return; }
    $('#profileInput').value = id;
    searchProfile();
  } catch (e) { toast(e.message); }
});
$('#profileForm').addEventListener('submit', (e) => { e.preventDefault(); searchProfile(); });

async function searchProfile() {
  const id = $('#profileInput').value.trim();
  if (!id) return;
  const out = $('#profileOut');
  out.innerHTML = loadingHtml('Profil yükleniyor…');
  try {
    renderProfile(await api.lookupProfile(id));
  } catch (err) {
    out.innerHTML = errorHtml(err.message);
  }
}

function rankCardHtml(title, e) {
  return `
    <div class="card rank-card">
      <div class="emblem-box">${e ? `<img class="emblem" src="${emblem(e.tier)}" alt="">` : '<div class="unranked"></div>'}</div>
      <div>
        <div class="q">${title}</div>
        <div class="tier">${tierText(e)}</div>
        ${e ? `<div class="lp">${e.leaguePoints} LP · ${winLoss(e)}</div>` : '<div class="lp">Bu sezon oynanmadı</div>'}
      </div>
    </div>`;
}

function renderProfile(p) {
  const s = p.summary;
  const bgChamp = p.masteries[0]?.champion?.id || s.champions[0]?.champion;
  const kdaCls = s.kda >= 3 ? 'good' : s.kda < 2 ? 'bad' : '';

  const recentChamps = s.champions.slice(0, 5).map((c) => `
    <div class="champ-line">${champImg(c.champion)}
      <div class="grow"><b>${esc(champName(c.champion))}</b>
        <div class="muted small">${c.games} maç · ${fix(c.kda, 2)} KDA</div></div>
      <div class="wr ${wrClass(c.winrate)}">${pct(c.winrate)}</div>
    </div>`).join('') || '<p class="muted">Veri yok</p>';

  const maxPts = p.masteries[0]?.championPoints || 1;
  const masteries = p.masteries.map((m) => `
    <div class="champ-line">${champImg(m.champion?.id)}
      <div class="grow"><b>${esc(m.champion?.name || m.championId)}</b>
        <div class="bar-mini"><div style="width:${Math.max(4, (m.championPoints / maxPts) * 100)}%"></div></div></div>
      <div class="muted small" style="text-align:right">Sv ${m.championLevel}<br><b style="color:var(--text)">${Math.round(m.championPoints / 1000)}k</b></div>
    </div>`).join('') || '<p class="muted">Veri yok</p>';

  $('#profileOut').innerHTML = `
    <div class="hero">
      ${bgChamp ? `<div class="hero-bg" style="background-image:url('${splash(bgChamp)}')"></div>` : ''}
      <div class="hero-content">
        <div class="avatar">
          <img src="${cdn(`profileicon/${p.summoner.profileIconId}.png`)}" alt="">
          <div class="lvl">${p.summoner.summonerLevel}</div>
        </div>
        <div>
          <h1>${esc(p.account.gameName)} <span>#${esc(p.account.tagLine)}</span></h1>
          <div class="hero-meta">
            ${s.mainRole ? `<span class="pill">${ROLE_TR[s.mainRole] || s.mainRole}</span>` : ''}
            <span class="pill">Kaynak: ${esc(p.source)}</span>
          </div>
        </div>
        <div class="hero-form">
          <div class="card-title">Son maçlar</div>
          ${formHtml(s.form)}
        </div>
      </div>
    </div>

    <div class="grid g3">
      ${rankCardHtml('Tek/Çift', p.solo)}
      ${rankCardHtml('Esnek', p.flex)}
      <div class="card">
        <div class="card-title">Son ${s.games} maç</div>
        <div class="kpis">
          <div class="kpi"><div class="v ${wrClass(s.games ? s.winrate : null)}">${pct(s.games ? s.winrate : null)}</div><div class="l">Kazanma</div></div>
          <div class="kpi"><div class="v ${kdaCls}">${fix(s.kda, 2)}</div><div class="l">KDA</div></div>
          <div class="kpi"><div class="v">${fix(s.csPerMin)}</div><div class="l">CS/dk</div></div>
          <div class="kpi"><div class="v">${pct(s.kp)}</div><div class="l">Katılım</div></div>
        </div>
      </div>
    </div>

    <div class="grid g2">
      <div class="card"><div class="card-title">Son maçlardaki şampiyonlar</div><div class="champ-list">${recentChamps}</div></div>
      <div class="card"><div class="card-title">En yüksek ustalık</div><div class="champ-list">${masteries}</div></div>
    </div>

    <div class="section-title">Maç Geçmişi <span class="count">${p.matches.length} maç</span></div>
    <div id="matchList">${p.matches.map(matchHtml).join('') || '<p class="muted">Maç bulunamadı.</p>'}</div>`;

  $('#matchList').addEventListener('click', (e) => {
    const row = e.target.closest('.match');
    if (!row) return;
    const next = row.nextElementSibling;
    if (next?.classList.contains('match-detail')) { next.remove(); row.classList.remove('open'); return; }
    const m = p.matches.find((x) => x.matchId === row.dataset.id);
    if (!m || m.participants.length < 2) { toast('Bu maçın detayı yok.'); return; }
    row.classList.add('open');
    row.insertAdjacentHTML('afterend', matchDetailHtml(m));
  });
}

function matchHtml(m) {
  const cls = m.remake ? '' : m.win ? 'win' : 'loss';
  return `
    <div class="match ${cls}" data-id="${esc(m.matchId)}">
      <div class="bar"></div>
      <div class="meta"><b>${m.remake ? 'Remake' : m.win ? 'Zafer' : 'Bozgun'}</b>${esc(m.queue)}<br>
        ${mmss(m.duration)} · ${timeAgo(m.start)}</div>
      <div class="champ">${champImg(m.champion)}<span class="cl">${m.championLevel ?? ''}</span></div>
      <div class="kda"><b>${m.kills} / <span class="d">${m.deaths}</span> / ${m.assists}</b>
        <div class="muted small">${fix(m.kda, 2)} KDA</div></div>
      <div class="extra">${m.cs} CS · ${fix(m.csPerMin)}/dk<br>KP ${pct(m.kp)} · Görüş ${m.vision ?? '-'}</div>
      ${itemsHtml(m.items)}
      <div class="chev">▾</div>
    </div>`;
}

function matchDetailHtml(m) {
  const maxDmg = Math.max(1, ...m.participants.map((x) => x.damage || 0));
  const team = (id) => {
    const players = m.participants.filter((x) => x.teamId === id);
    const won = players[0]?.win;
    return `<div><h5 class="${won ? 'w' : 'l'}">${won ? 'Zafer' : 'Bozgun'} · ${id === 100 ? 'Mavi' : 'Kırmızı'}</h5><table>${players.map((x) => `
      <tr class="${x.isMe ? 'me' : ''}">
        <td>${champImg(x.champion)}</td>
        <td class="nm" title="${esc(x.name)}">${esc(x.name)}</td>
        <td><b>${x.kills}/${x.deaths}/${x.assists}</b></td>
        <td class="muted">${x.cs} CS</td>
        <td title="${x.damage} hasar"><div class="dmg"><div style="width:${((x.damage || 0) / maxDmg) * 100}%"></div></div></td>
      </tr>`).join('')}</table></div>`;
  };
  return `<div class="match-detail">${team(100)}${team(200)}</div>`;
}

// ---------- Canlı oyun ----------
function setLiveMode(inGame) {
  $('#liveDot').classList.toggle('on', inGame);
  $('#liveStatus').classList.toggle('on', inGame);
  if (!inGame) $('#liveBoard').innerHTML = '';
  updateLiveEmpty();
}
function updateLiveEmpty() {
  const hasContent = $('#liveBoard').innerHTML.trim() || !$('#analysisWrap').classList.contains('hidden');
  $('#liveEmpty').classList.toggle('hidden', !!hasContent);
}

api.onLiveState(({ inGame }) => {
  $('#liveStatus').textContent = inGame ? 'Oyunda' : 'Oyun bekleniyor…';
  setLiveMode(inGame);
  if (inGame) showView('live');
});

api.onLiveUpdate((snap) => {
  const st = $('#liveStatus');
  st.textContent = `Oyunda · ${snap.gameMode || ''} · ${snap.me.gold} altın`;
  if (!st.classList.contains('on')) setLiveMode(true);
  const A = snap.teams[snap.myTeam];
  const E = snap.teams[snap.enemyTeam];
  const goldDiff = A.itemGold - E.itemGold;
  const obj = (t) => `
    <div class="obj"><span>Kule <b>${t.towers}</b></span><span>Ejder <b>${t.dragons.length}</b></span>
      <span>Baron <b>${t.barons}</b></span><span>Larva <b>${t.grubs}</b></span><span>Alamet <b>${t.heralds}</b></span></div>`;
  const rows = (team) => snap.players.filter((p) => p.team === team).map((p) => `
    <tr class="${p.isMe ? 'me' : ''} ${p.isDead ? 'dead' : ''}">
      <td>${champImg(p.champion?.id, 'c')}</td>
      <td><div class="nm" title="${esc(p.riotId)}">${esc(p.riotId)}</div>
        <div class="muted small">Sv ${p.level}${p.isDead ? ` · ${Math.ceil(p.respawnTimer)} sn` : ''}</div></td>
      <td><b>${p.kills}/${p.deaths}/${p.assists}</b><div class="muted small">${p.cs} CS</div></td>
      <td>${itemsHtml(p.items)}</td>
    </tr>`).join('');

  $('#liveBoard').innerHTML = `
    <div class="card scoreboard">
      <div class="side ally"><div class="lbl">Senin takımın</div><div class="big">${A.kills}</div>${obj(A)}</div>
      <div class="clock"><div class="t">${mmss(snap.gameTime)}</div>
        <div class="gold-diff ${goldDiff >= 0 ? 'pos' : 'neg'}">${goldDiff >= 0 ? '+' : ''}${(goldDiff / 1000).toFixed(1)}k altın</div></div>
      <div class="side enemy right"><div class="lbl">Rakip</div><div class="big">${E.kills}</div>${obj(E)}</div>
    </div>
    <div class="board">
      <div class="card"><table>${rows(snap.myTeam)}</table></div>
      <div class="card"><table>${rows(snap.enemyTeam)}</table></div>
    </div>`;
  updateLiveEmpty();
});

api.onAnalysisStart(({ myTeam, players }) => {
  $('#analysisWrap').classList.remove('hidden');
  updateLiveEmpty();
  $('#teamSummary').innerHTML = '';
  $('#enemyCards').innerHTML = '';
  $('#allyCards').innerHTML = '';
  for (const p of players) {
    const box = p.team === myTeam ? $('#allyCards') : $('#enemyCards');
    box.insertAdjacentHTML('beforeend', `
      <div class="pcard loading" data-key="${esc(p.riotId)}">
        <div class="pic">${champImg(p.champion?.id, 'c')}</div>
        <div><div class="name">${esc(p.riotId)}</div><div class="sub">${esc(p.champion?.name || '')}</div>
          <div class="sk" style="width:80%"></div><div class="sk" style="width:55%"></div></div>
        <div></div>
      </div>`);
  }
});

api.onAnalysisPlayer((r) => {
  const card = [...document.querySelectorAll('.pcard')].find((c) => c.dataset.key === r.riotId);
  if (card) card.outerHTML = playerCardHtml(r);
});

api.onAnalysisDone(({ ally, enemy }) => {
  const box = (title, t, cls) => `
    <div class="card ${cls}">
      <div><div class="t">${title}</div></div>
      <div><div class="v">${esc(trRankLabel(t.avgRankLabel))}</div><div class="l">Ort. derece</div></div>
      <div><div class="v">${t.avgThreat}</div><div class="l">Ort. tehdit</div></div>
      ${t.mostDangerous ? `<div><div class="v">${esc(t.mostDangerous.champion?.name || t.mostDangerous.riotId)}</div><div class="l">En tehlikeli</div></div>` : ''}
    </div>`;
  $('#teamSummary').innerHTML = box('Rakip', enemy, 'enemy') + box('Takımın', ally, 'ally');
});

// "DIAMOND IV" → "Elmas IV", "Master+" → "Ustalık+"
const trRankLabel = (label) => String(label || '')
  .replace(/^Master\+$/, 'Ustalık+')
  .replace(/^([A-Z]+)/, (m) => TIER_TR[m] || m);

function threatColor(v) { return v >= 70 ? 'var(--loss)' : v >= 45 ? 'var(--warn)' : 'var(--good)'; }

function playerCardHtml(r) {
  if (r.error) {
    return `<div class="pcard" data-key="${esc(r.riotId)}"><div class="pic"><img class="c" alt=""></div>
      <div><div class="name">${esc(r.riotId)}</div><div class="err">${esc(r.error)}</div></div><div></div></div>`;
  }
  const s = r.summary;
  const cs = r.champStats;
  const role = r.position ? ROLE_TR[r.position] || r.position : '';
  return `
    <div class="pcard" data-key="${esc(r.riotId)}">
      <div class="pic">${champImg(r.champion?.id, 'c')}${role ? `<span class="role">${role}</span>` : ''}</div>
      <div style="min-width:0">
        <div class="name" title="${esc(r.riotId)}">${esc(r.riotId)}</div>
        <div class="rank-line">
          ${r.solo ? `<img src="${emblem(r.solo.tier)}" alt="">` : ''}
          <b>${r.solo ? rankText(r.solo) : 'Derecesiz'}</b>
          ${r.solo ? `<span class="muted">· ${winLoss(r.solo)}</span>` : ''}
        </div>
        <div class="stats">
          <span>Son ${s.games}: <b style="color:${!s.games ? 'inherit' : s.winrate >= 0.5 ? 'var(--good)' : 'var(--loss)'}">${pct(s.games ? s.winrate : null)}</b></span>
          <span>KDA <b>${fix(s.kda, 2)}</b></span>
          <span>${esc(r.champion?.name || 'Şampiyon')}: <b>${cs ? `${cs.games} maç · ${pct(cs.winrate)}` : 'yeni'}</b></span>
          <span>Ustalık <b>${Math.round(r.masteryPoints / 1000)}k</b></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px">${formHtml(s.form)}
          <span class="muted small">${s.topChampions.map((c) => esc(champName(c.champion))).join(' · ')}</span></div>
        ${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag ${t.kind}">${esc(t.text)}</span>`).join('')}</div>` : ''}
      </div>
      <div><div class="threat-ring" data-v="${r.threat}" style="--v:${r.threat};--c:${threatColor(r.threat)}"></div>
        <div class="threat-cap">Tehdit</div></div>
    </div>`;
}

$('#btnAnalyze').addEventListener('click', async () => {
  const btn = $('#btnAnalyze');
  btn.disabled = true;
  try {
    const g = await api.analyzeGame();
    if (!$('#liveStatus').classList.contains('on')) $('#liveStatus').textContent = `Aktif oyun bulundu${g.queue ? `: ${g.queue}` : ''}`;
  } catch (e) { toast(e.message); }
  btn.disabled = false;
});
api.onAnalysisAuto(() => showView('live'));
api.onAnalysisError((msg) => toast(msg));

const PHASE_TR = {
  None: 'Ana ekranda', Lobby: 'Lobide', Matchmaking: 'Sırada', ReadyCheck: 'Maç bulundu', ChampSelect: 'Şampiyon seçimi',
  GameStart: 'Oyun başlıyor', InProgress: 'Oyunda', Reconnect: 'Yeniden bağlan', WaitingForStats: 'Oyun bitti',
  PreEndOfGame: 'Oyun bitti', EndOfGame: 'Oyun bitti',
};
api.onClientPhase((phase) => {
  const st = $('#liveStatus');
  if (!st.classList.contains('on')) {
    st.textContent = phase ? `İstemci bağlı · ${PHASE_TR[phase] || phase}` : 'League istemcisi kapalı';
  }
  refreshSource();
});

async function refreshSource() {
  const b = $('#sourceBadge');
  try {
    const s = await api.sourceStatus();
    b.textContent = s.source ? s.label : 'League istemcisi kapalı';
    b.className = `chip ${s.source ? 'ok' : 'bad'}`;
  } catch { b.textContent = 'Bağlantı yok'; b.className = 'chip bad'; }
}

// ---------- Ayarlar ----------
function fillSettings(s) {
  settings = s;
  $('#sDataSource').value = s.dataSource || 'auto';
  $('#sApiKey').value = '';
  $('#sApiKeyState').textContent = s.apiKeySet ? 'Anahtar kayıtlı. Değiştirmek için yenisini yapıştır.' : 'Kayıtlı değil (gerekli değil).';
  $('#btnClearKey').classList.toggle('hidden', !s.apiKeySet);
  $('#sPlatform').value = s.platform;
  $('#sRiotId').value = s.riotId;
  $('#sProfileCount').value = s.profileMatchCount;
  $('#sLiveCount').value = s.liveMatchCount;
  $('#sAutoAnalyze').checked = s.autoAnalyze;
  $('#sOnTop').checked = s.alwaysOnTop;
  $('#sHotkey').value = s.overlayHotkey || '';
  $('#sHotkey').dataset.value = s.overlayHotkey || '';
  $('#sOverlayPos').value = s.overlayPosition || 'right';
  $('#sOpacity').value = s.overlayOpacity ?? 0.88;
  $('#sOpacityVal').textContent = `%${Math.round((s.overlayOpacity ?? 0.88) * 100)}`;
  $('#sOverlayAuto').checked = !!s.overlayAutoShow;
  $('#sCloseToTray').checked = s.closeToTray !== false;
  $('#hotkeyHint').innerHTML = s.overlayHotkey
    ? `Oyun içinde <span class="kbd">${esc(s.overlayHotkey)}</span> ile küçük pencereyi aç/kapat.` : '';
  refreshSource();
}

// ---------- Kısayol kaydedici ----------
// Klavye olayını Electron'un kısayol biçimine çevirir: "Ctrl+Shift+X", "Alt+F1"...
function keyName(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c;
  if (/^Numpad\d$/.test(c)) return `num${c.slice(6)}`;
  const map = {
    Space: 'Space', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };
  return map[c] || null;
}
const hk = $('#sHotkey');
hk.addEventListener('focus', () => { hk.classList.add('recording'); hk.value = 'Tuşlara bas…'; });
hk.addEventListener('blur', () => { hk.classList.remove('recording'); hk.value = hk.dataset.value || ''; });
hk.addEventListener('keydown', (e) => {
  e.preventDefault();
  if (e.code === 'Escape') { hk.blur(); return; }
  if (e.code === 'Backspace' || e.code === 'Delete') { hk.dataset.value = ''; hk.blur(); return; } // kapat
  const key = keyName(e);
  if (!key) return; // sadece Ctrl/Alt/Shift basıldı
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  // Tek başına harf/rakam oyunda yetenek tuşlarını bozar; F tuşları hariç değiştirici iste
  if (!mods.length && !/^F\d+$/.test(key)) { toast('Ctrl, Alt veya Shift ile birlikte bas (ör. Alt+X). F tuşları tek başına olabilir.'); return; }
  hk.dataset.value = [...mods, key].join('+');
  hk.blur();
});
$('#sOpacity').addEventListener('input', (e) => { $('#sOpacityVal').textContent = `%${Math.round(e.target.value * 100)}`; });
// "Windows ile başlat" anında uygulanır (Kaydet beklemez)
async function loadStartup() {
  try {
    const st = await api.getStartup();
    $('#sStartup').checked = st.enabled;
    $('#sStartup').disabled = !st.supported;
    if (!st.supported) $('#sStartupNote').textContent = 'Sadece kurulu .exe sürümünde çalışır.';
  } catch { /* yok say */ }
}
$('#sStartup').addEventListener('change', async (e) => {
  try { e.target.checked = await api.setStartup(e.target.checked); } catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
});

$('#btnOverlayPreview').addEventListener('click', async () => {
  try {
    const visible = await api.toggleOverlay();
    $('#btnOverlayPreview').textContent = visible ? 'Gizle' : 'Önizle';
  } catch (e) { toast(e.message); }
});

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const s = await api.setSettings({
      dataSource: $('#sDataSource').value,
      apiKey: $('#sApiKey').value,
      platform: $('#sPlatform').value,
      riotId: $('#sRiotId').value.trim(),
      profileMatchCount: Math.max(5, Math.min(50, Number($('#sProfileCount').value) || 15)),
      liveMatchCount: Math.max(0, Math.min(20, Number($('#sLiveCount').value) || 0)),
      autoAnalyze: $('#sAutoAnalyze').checked,
      alwaysOnTop: $('#sOnTop').checked,
      overlayHotkey: $('#sHotkey').dataset.value || '',
      overlayPosition: $('#sOverlayPos').value,
      overlayOpacity: Number($('#sOpacity').value),
      overlayAutoShow: $('#sOverlayAuto').checked,
      closeToTray: $('#sCloseToTray').checked,
    });
    fillSettings(s);
    $('#settingsSaved').textContent = 'Kaydedildi ✓';
    setTimeout(() => ($('#settingsSaved').textContent = ''), 2500);
  } catch (err) { toast(err.message); }
});
$('#btnClearKey').addEventListener('click', async () => {
  try { fillSettings(await api.clearApiKey()); } catch (e) { toast(e.message); }
});
$('#devLink').addEventListener('click', (e) => { e.preventDefault(); api.openExternal('https://developer.riotgames.com/'); });

// ---------- Başlangıç ----------
(async () => {
  try { fillSettings(await api.getSettings()); } catch (e) { toast(e.message); }
  loadStartup();
  try {
    dd = await api.getDDragon();
    for (const c of Object.values(dd.champsByKey)) champNameById[c.id] = c.name;
  } catch { toast('Şampiyon verisi yüklenemedi (internet bağlantısını kontrol et).'); }
  const st = await api.liveStatus().catch(() => ({ inGame: false }));
  setLiveMode(st.inGame);
  // İstemci açıksa kendi profilini otomatik getir
  const me = await api.myRiotId().catch(() => '');
  if (me) { $('#profileInput').value = me; searchProfile(); }
})();

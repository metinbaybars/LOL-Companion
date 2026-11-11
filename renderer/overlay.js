/* global overlayApi */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const TIER_SHORT = { IRON: 'Demir', BRONZE: 'Bronz', SILVER: 'Gümüş', GOLD: 'Altın', PLATINUM: 'Plat', EMERALD: 'Zümrüt', DIAMOND: 'Elmas', MASTER: 'Master', GRANDMASTER: 'GM', CHALLENGER: 'Chall' };
const DIV = { I: 1, II: 2, III: 3, IV: 4 };
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const ROLE_TR = { TOP: 'Üst', JUNGLE: 'Orman', MIDDLE: 'Orta', BOTTOM: 'Nişancı', UTILITY: 'Destek' };

const rankShort = (s) => (s ? `${TIER_SHORT[s.tier] || s.tier}${APEX.includes(s.tier) ? ` ${s.lp}LP` : ` ${DIV[s.rank] || ''}`}` : 'Derecesiz');
const threatColor = (v) => (v >= 70 ? 'var(--loss)' : v >= 45 ? 'var(--warn)' : 'var(--good)');

document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

function render(d) {
  document.body.classList.toggle('bottom', d.position?.startsWith('bottom'));
  $('#panel').style.setProperty('--bg-alpha', d.opacity ?? 0.88);
  $('#hint').textContent = d.hotkey ? `${d.hotkey} ile gizle` : '';
  const img = (id) => (id && d.ddVersion ? `<img src="https://ddragon.leagueoflegends.com/cdn/${d.ddVersion}/img/champion/${esc(id)}.png" alt="">` : '<img alt="">');

  let html = '';
  if (d.score) {
    const s = d.score;
    html += `
      <div class="head">
        <span class="clock">${mmss(d.gameTime)}</span>
        <span class="gold ${s.goldDiff >= 0 ? 'pos' : 'neg'}">${s.goldDiff >= 0 ? '+' : ''}${(s.goldDiff / 1000).toFixed(1)}k</span>
        <span class="score"><span class="a">${s.ally.kills}</span><span class="sep">–</span><span class="e">${s.enemy.kills}</span></span>
      </div>
      <div class="obj">
        <span class="a">Kule <b>${s.ally.towers}</b> · Ejder <b>${s.ally.dragons.length}</b> · Baron <b>${s.ally.barons}</b></span>
        <span class="e">Kule <b>${s.enemy.towers}</b> · Ejder <b>${s.enemy.dragons.length}</b> · Baron <b>${s.enemy.barons}</b></span>
      </div>`;
  }

  if (!d.enemies?.length) {
    html += `<div class="empty"><b>${d.inGame ? 'Analiz bekleniyor' : 'Aktif oyun yok'}</b>
      ${d.inGame ? 'Rakip bilgileri yükleniyor…' : 'Maç yüklenince rakip analizi burada görünür.'}</div>`;
  } else {
    html += `<div class="title"><span>Rakip takım</span><span>${d.enemySummary ? `Ort. ${esc(String(d.enemySummary.avgRankLabel).replace(/^([A-Z]+)/, (m) => TIER_SHORT[m] || m))}` : ''}</span></div>`;
    for (const e of d.enemies) {
      const r = e.report;
      const role = r?.position ? ROLE_TR[r.position] || '' : '';
      let sub = '<span class="loading">yükleniyor…</span>';
      if (r?.error) sub = `<span class="loading">${esc(r.error)}</span>`;
      else if (r) {
        const wr = r.games ? `${Math.round(r.winrate * 100)}%` : '-';
        const champ = r.champGames ? `${r.champGames} maç` : 'yeni';
        sub = `<span class="rk">${rankShort(r.solo)}</span> · Son ${r.games}: ${wr} · Şamp: ${champ}`;
      }
      const chips = (r?.tags || []).slice(0, 3).map((t) => `<span class="chip ${t.kind}">${esc(t.text)}</span>`).join('');
      html += `
        <div class="row ${e.isDead ? 'dead' : ''}">
          <div class="pic">${img(e.champion?.id)}${e.isDead ? `<span class="timer">${Math.ceil(e.respawn || 0)}</span>` : e.level ? `<span class="lv">${e.level}</span>` : ''}</div>
          <div style="min-width:0">
            <div class="nm">${esc(e.champion?.name || e.riotId)}${role ? ` <span style="color:var(--muted);font-weight:500">· ${role}</span>` : ''}</div>
            <div class="sub">${sub}</div>
            ${chips ? `<div class="chips">${chips}</div>` : ''}
          </div>
          <div class="kda">${e.kills != null ? `${e.kills}/<span class="d">${e.deaths}</span>/${e.assists}<small>${e.cs} CS</small>` : ''}</div>
          <div>${r && !r.error ? `<div class="threat" style="--v:${r.threat};--c:${threatColor(r.threat)}"><span>${r.threat}</span></div>` : ''}</div>
        </div>`;
    }
    if (d.enemySummary && d.allySummary) {
      html += `<div class="summary"><span>Tehdit: <b style="color:var(--loss)">${d.enemySummary.avgThreat}</b> rakip / <b style="color:var(--win)">${d.allySummary.avgThreat}</b> takımın</span>
        ${d.enemySummary.mostDangerous ? `<span>Dikkat: <b>${esc(d.enemySummary.mostDangerous.champion?.name || '')}</b></span>` : ''}</div>`;
    }
  }
  $('#content').innerHTML = html;
}

overlayApi.onData(render);

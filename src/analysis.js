// Ham Riot verisinden istatistik, etiket ve tehdit puanı üretir.

const QUEUES = {
  400: 'Normal (Seçmeli)', 420: 'Dereceli Tek/Çift', 430: 'Normal (Kapalı)', 440: 'Dereceli Esnek',
  450: 'ARAM', 480: 'Tam Gaz', 490: 'Hızlı Oyun', 700: 'Clash', 830: 'Yapay Zeka', 840: 'Yapay Zeka', 850: 'Yapay Zeka',
  900: 'ARURF', 1700: 'Arena', 1710: 'Arena', 1740: 'Cesaret Arenası', 1750: 'Arena 3x6', 1900: 'URF', 2400: 'ARAM: Şamata',
};
// İstemciden alınan güncel kuyruk adları (varsa) sabit listeyi geçersiz kılar
const dynamicQueues = {};
const setQueueNames = (map) => Object.assign(dynamicQueues, map);
const queueName = (id) => dynamicQueues[id] || QUEUES[id] || `Mod ${id}`;

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVS = { IV: 0, III: 1, II: 2, I: 3 };

function rankValue(entry) {
  if (!entry) return null;
  const t = TIERS.indexOf(entry.tier);
  if (t < 0) return null;
  if (t >= 7) return 28 + (entry.leaguePoints || 0) / 250; // Master+ tek kademe
  return t * 4 + (DIVS[entry.rank] ?? 0) + (entry.leaguePoints || 0) / 100;
}
function rankLabelFromValue(v) {
  if (v == null) return 'Derecesiz';
  if (v >= 28) return 'Master+';
  const t = Math.floor(v / 4);
  const d = ['IV', 'III', 'II', 'I'][Math.floor(v % 4)];
  return `${TIERS[t]} ${d}`;
}

const soloEntry = (league) => (league || []).find((e) => e.queueType === 'RANKED_SOLO_5x5') || null;
const flexEntry = (league) => (league || []).find((e) => e.queueType === 'RANKED_FLEX_SR') || null;

const me = (match, puuid) => match?.info?.participants?.find((p) => p.puuid === puuid);
const isRemake = (match) => (match?.info?.gameDuration || 0) < 300;

function matchRow(match, puuid) {
  const p = me(match, puuid);
  if (!p) return null;
  const mins = Math.max(1, match.info.gameDuration / 60);
  // İstemcinin maç listesi sadece oyuncunun kendisini içerir; o durumda KP hesaplanamaz
  const team = match.info.participants.filter((x) => x.teamId === p.teamId);
  const teamKills = team.length > 1 ? team.reduce((s, x) => s + x.kills, 0) : 0;
  return {
    matchId: match.metadata.matchId,
    queue: queueName(match.info.queueId),
    queueId: match.info.queueId,
    start: match.info.gameStartTimestamp,
    duration: match.info.gameDuration,
    remake: isRemake(match),
    win: p.win,
    champion: p.championName,
    championLevel: p.champLevel,
    role: p.teamPosition || p.individualPosition || '',
    kills: p.kills, deaths: p.deaths, assists: p.assists,
    kda: (p.kills + p.assists) / Math.max(1, p.deaths),
    kp: teamKills ? (p.kills + p.assists) / teamKills : null,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    csPerMin: (p.totalMinionsKilled + p.neutralMinionsKilled) / mins,
    damage: p.totalDamageDealtToChampions,
    gold: p.goldEarned,
    vision: p.visionScore,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
    participants: match.info.participants.map((x) => ({
      name: x.riotIdGameName ? `${x.riotIdGameName}#${x.riotIdTagline}` : x.summonerName,
      champion: x.championName, teamId: x.teamId, win: x.win,
      kills: x.kills, deaths: x.deaths, assists: x.assists,
      cs: x.totalMinionsKilled + x.neutralMinionsKilled, damage: x.totalDamageDealtToChampions,
      items: [x.item0, x.item1, x.item2, x.item3, x.item4, x.item5, x.item6],
      isMe: x.puuid === puuid,
    })),
  };
}

function summarize(matches, puuid) {
  const rows = matches.map((m) => matchRow(m, puuid)).filter((r) => r && !r.remake);
  const n = rows.length;
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const wins = sum((r) => (r.win ? 1 : 0));

  const champs = {};
  const roles = {};
  for (const r of rows) {
    const c = (champs[r.champion] ||= { champion: r.champion, games: 0, wins: 0, k: 0, d: 0, a: 0 });
    c.games++; c.wins += r.win ? 1 : 0; c.k += r.kills; c.d += r.deaths; c.a += r.assists;
    if (r.role) roles[r.role] = (roles[r.role] || 0) + 1;
  }
  const champList = Object.values(champs)
    .map((c) => ({ ...c, winrate: c.wins / c.games, kda: (c.k + c.a) / Math.max(1, c.d) }))
    .sort((a, b) => b.games - a.games);

  // Seri: en yeni maçtan geriye doğru
  let streak = 0;
  for (const r of rows) {
    if (streak === 0) streak = r.win ? 1 : -1;
    else if (r.win && streak > 0) streak++;
    else if (!r.win && streak < 0) streak--;
    else break;
  }

  const mainRole = Object.entries(roles).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    games: n,
    wins,
    winrate: n ? wins / n : 0,
    avgKills: n ? sum((r) => r.kills) / n : 0,
    avgDeaths: n ? sum((r) => r.deaths) / n : 0,
    avgAssists: n ? sum((r) => r.assists) / n : 0,
    kda: sum((r) => r.kills + r.assists) / Math.max(1, sum((r) => r.deaths)),
    csPerMin: n ? sum((r) => r.csPerMin) / n : 0,
    kp: rows.some((r) => r.kp != null) ? sum((r) => r.kp || 0) / rows.filter((r) => r.kp != null).length : null,
    vision: n ? sum((r) => r.vision) / n : 0,
    champions: champList,
    roles,
    mainRole,
    streak,
    form: rows.slice(0, 10).map((r) => (r.win ? 'W' : 'L')),
  };
}

// Canlı oyundaki bir oyuncu için rapor
function playerReport({ riotId, puuid, team, champion, position, league, mastery, summoner, matches }) {
  const summary = summarize(matches, puuid);
  const solo = soloEntry(league);
  const flex = flexEntry(league);
  const champStats = champion ? summary.champions.find((c) => c.champion === champion.id) : null;
  const masteryPoints = mastery?.championPoints || 0;
  const level = summoner?.summonerLevel || null;
  const lossesKnown = solo && solo.losses != null;
  const rankedGames = lossesKnown ? solo.wins + solo.losses : 0;
  const rankedWr = rankedGames ? solo.wins / rankedGames : null;

  const tags = [];
  const add = (text, kind) => tags.push({ text, kind }); // kind: danger | good | warn | info
  if (summary.games >= 5 && champStats && champStats.games / summary.games >= 0.6) add('OTP', 'danger');
  if (masteryPoints >= 300000) add(`Uzman (${Math.round(masteryPoints / 1000)}k)`, 'danger');
  else if (champion && masteryPoints < 10000 && !champStats) add('Şampiyonda deneyimsiz', 'good');
  if (summary.streak >= 3) add(`${summary.streak} galibiyet serisi`, 'danger');
  if (summary.streak <= -3) add(`${-summary.streak} mağlubiyet serisi`, 'good');
  if (level && level < 60 && rankedWr != null && rankedWr >= 0.6 && rankedGames >= 15) add('Smurf şüphesi', 'danger');
  if (summary.games >= 5 && summary.kda >= 4) add('Yüksek KDA', 'warn');
  if (summary.games >= 5 && summary.avgDeaths >= 8) add('Çok ölüyor', 'good');
  if (rankedGames >= 100 && rankedWr != null && rankedWr < 0.47) add('Düşük dereceli WR', 'good');
  if (summary.mainRole && position && normalizeRole(position) && normalizeRole(position) !== summary.mainRole) {
    add('Ana rolü dışında', 'good');
  }

  // Tehdit puanı (0-100): derece + son form + şampiyon deneyimi
  const rv = rankValue(solo);
  let threat = 40;
  if (rv != null) threat = 15 + (rv / 32) * 45;
  threat += (summary.winrate - 0.5) * 40 * Math.min(1, summary.games / 8);
  threat += Math.min(10, (summary.kda - 2.5) * 3);
  if (champStats) threat += Math.min(10, champStats.games * 2) * (champStats.winrate >= 0.5 ? 1 : 0.4);
  if (masteryPoints >= 100000) threat += 5;
  if (champion && !champStats && masteryPoints < 10000) threat -= 8;
  threat = Math.max(0, Math.min(100, Math.round(threat)));

  return {
    riotId, puuid, team, position: normalizeRole(position) || summary.mainRole,
    champion, level,
    solo: solo && { tier: solo.tier, rank: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses, winrate: rankedWr },
    flex: flex && { tier: flex.tier, rank: flex.rank, lp: flex.leaguePoints, wins: flex.wins, losses: flex.losses },
    rankValue: rv,
    masteryPoints,
    masteryLevel: mastery?.championLevel || 0,
    champStats,
    summary: {
      games: summary.games, winrate: summary.winrate, kda: summary.kda, csPerMin: summary.csPerMin,
      avgKills: summary.avgKills, avgDeaths: summary.avgDeaths, avgAssists: summary.avgAssists,
      mainRole: summary.mainRole, form: summary.form, topChampions: summary.champions.slice(0, 3),
    },
    tags,
    threat,
  };
}

function normalizeRole(pos) {
  const p = String(pos || '').toUpperCase();
  if (!p || p === 'NONE' || p === 'INVALID') return null;
  if (p === 'MID') return 'MIDDLE';
  if (p === 'ADC' || p === 'BOT') return 'BOTTOM';
  if (p === 'SUPPORT') return 'UTILITY';
  return p;
}

function teamSummary(reports) {
  const ranked = reports.filter((r) => r.rankValue != null);
  const avgRank = ranked.length ? ranked.reduce((s, r) => s + r.rankValue, 0) / ranked.length : null;
  const avgThreat = reports.length ? reports.reduce((s, r) => s + r.threat, 0) / reports.length : 0;
  const top = [...reports].sort((a, b) => b.threat - a.threat)[0] || null;
  return {
    avgRank, avgRankLabel: rankLabelFromValue(avgRank), avgThreat: Math.round(avgThreat),
    mostDangerous: top && { riotId: top.riotId, champion: top.champion, threat: top.threat },
  };
}

// ---- Canlı oyun anlık görüntüsü (Live Client verisinden) ----
const riotIdOf = (p) => p.riotId || (p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagLine}` : p.summonerName);

function liveSnapshot(data, ddragon) {
  const active = data.activePlayer || {};
  const meId = active.riotId || (active.riotIdGameName ? `${active.riotIdGameName}#${active.riotIdTagLine}` : active.summonerName);
  const nameToTeam = {};
  for (const p of data.allPlayers) {
    for (const n of [p.summonerName, p.riotId, p.riotIdGameName, riotIdOf(p)]) if (n) nameToTeam[n] = p.team;
  }
  const meP = data.allPlayers.find((p) => riotIdOf(p) === meId || p.summonerName === active.summonerName);
  const myTeam = meP?.team || 'ORDER';

  const teams = { ORDER: newTeam(), CHAOS: newTeam() };
  const players = data.allPlayers.map((p) => {
    const champ = ddragon.resolveChampion({ championName: p.championName, rawChampionName: p.rawChampionName });
    const itemGold = (p.items || []).reduce((s, it) => s + (ddragon.state.items[it.itemID]?.gold || 0) * (it.count || 1), 0);
    const t = teams[p.team];
    if (t) { t.kills += p.scores?.kills || 0; t.itemGold += itemGold; t.cs += p.scores?.creepScore || 0; }
    return {
      riotId: riotIdOf(p), team: p.team, isMe: p === meP, champion: champ,
      championName: p.championName, level: p.level, position: p.position,
      kills: p.scores?.kills || 0, deaths: p.scores?.deaths || 0, assists: p.scores?.assists || 0,
      cs: p.scores?.creepScore || 0, ward: p.scores?.wardScore || 0,
      items: (p.items || []).map((i) => i.itemID), itemGold,
      isDead: p.isDead, respawnTimer: p.respawnTimer,
    };
  });

  for (const ev of data.events?.Events || []) {
    const killerTeam = nameToTeam[ev.KillerName];
    switch (ev.EventName) {
      case 'DragonKill': if (killerTeam) teams[killerTeam].dragons.push(ev.DragonType); break;
      case 'BaronKill': if (killerTeam) teams[killerTeam].barons++; break;
      case 'HeraldKill': if (killerTeam) teams[killerTeam].heralds++; break;
      case 'HordeKill': if (killerTeam) teams[killerTeam].grubs++; break;
      case 'TurretKilled': {
        // Turret_T1_... = ORDER (mavi) kulesi; yıkan karşı takımdır
        const victim = /_T1_/.test(ev.TurretKilled) ? 'ORDER' : /_T2_/.test(ev.TurretKilled) ? 'CHAOS' : null;
        if (victim) teams[victim === 'ORDER' ? 'CHAOS' : 'ORDER'].towers++;
        break;
      }
      case 'InhibKilled': {
        const victim = /_T1_/.test(ev.InhibKilled) ? 'ORDER' : /_T2_/.test(ev.InhibKilled) ? 'CHAOS' : null;
        if (victim) teams[victim === 'ORDER' ? 'CHAOS' : 'ORDER'].inhibs++;
        break;
      }
      default:
    }
  }

  const enemyTeam = myTeam === 'ORDER' ? 'CHAOS' : 'ORDER';
  return {
    gameTime: data.gameData?.gameTime || 0,
    gameMode: data.gameData?.gameMode,
    myTeam, enemyTeam,
    me: {
      riotId: meId, level: active.level, gold: Math.floor(active.currentGold || 0),
      stats: active.championStats || {},
    },
    teams,
    players,
  };
}

function newTeam() {
  return { kills: 0, itemGold: 0, cs: 0, dragons: [], barons: 0, heralds: 0, grubs: 0, towers: 0, inhibs: 0 };
}

module.exports = {
  summarize, matchRow, playerReport, teamSummary, liveSnapshot, riotIdOf,
  soloEntry, flexEntry, queueName, setQueueNames, rankValue, rankLabelFromValue, normalizeRole,
};

// Veri sağlayıcıları: aynı arayüzü iki kaynakla uygular.
//  - LcuProvider:  açık League istemcisi (anahtar gerekmez, varsayılan)
//  - RiotProvider: Riot API (geliştirici/üretim anahtarı ile, isteğe bağlı)
// Not: İki kaynağın PUUID'leri farklıdır; bir analiz boyunca tek sağlayıcı kullanılmalı.
//
// Ortak arayüz:
//   findPlayer(gameName, tagLine) -> { puuid, gameName, tagLine }
//   getSummoner(puuid)            -> { summonerLevel, profileIconId }
//   getLeague(puuid)              -> [{ queueType, tier, rank, leaguePoints, wins, losses }]  (Riot formatı)
//   getTopMasteries(puuid, n)     -> [{ championId, championLevel, championPoints }]
//   getChampionMastery(puuid, id) -> { championLevel, championPoints } | null
//   getMatches(puuid, count, {full}) -> match-v5 biçiminde maçlar
//   getMatch(matchId)             -> match-v5 biçiminde tek maç
//   getActiveGame({ live, riotId }) -> { players:[{riotId,puuid?,team,championId?,...}], myTeam, queue } | null
//   getCurrentPlayer()            -> { gameName, tagLine } | null

const ddragon = require('./ddragon');
const { parseRiotId } = require('./riot-api');
const analysis = require('./analysis');

const UNRANKED = new Set(['', 'NONE', 'UNRANKED']);

// Basit eşzamanlılık sınırlayıcı
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// ---------------- League istemcisi ----------------
function lcuRole(timeline = {}) {
  const lane = String(timeline.lane || '').toUpperCase();
  const role = String(timeline.role || '').toUpperCase();
  if (lane === 'TOP') return 'TOP';
  if (lane === 'JUNGLE') return 'JUNGLE';
  if (lane === 'MIDDLE' || lane === 'MID') return 'MIDDLE';
  if (lane === 'BOTTOM' || lane === 'BOT') return role.includes('SUPPORT') ? 'UTILITY' : 'BOTTOM';
  return '';
}

function lcuGameToV5(g) {
  const ids = Object.fromEntries((g.participantIdentities || []).map((pi) => [pi.participantId, pi.player || {}]));
  return {
    metadata: { matchId: String(g.gameId) },
    info: {
      gameDuration: g.gameDuration,
      queueId: g.queueId,
      gameStartTimestamp: g.gameCreation,
      participants: (g.participants || []).map((p) => {
        const pl = ids[p.participantId] || {};
        const s = p.stats || {};
        const champ = ddragon.resolveChampion({ championId: p.championId });
        return {
          ...s,
          puuid: pl.puuid, riotIdGameName: pl.gameName, riotIdTagline: pl.tagLine, summonerName: pl.summonerName,
          teamId: p.teamId, win: !!s.win, championId: p.championId,
          championName: champ?.id || String(p.championId),
          teamPosition: lcuRole(p.timeline),
        };
      }),
    },
  };
}

class LcuProvider {
  constructor(lcu) {
    this.lcu = lcu;
    this.name = 'lcu';
    this.label = 'League istemcisi';
    this.masteryCache = new Map();
    this.gameCache = new Map();
    this._avail = { at: 0, ok: false };
  }

  async available() {
    if (Date.now() - this._avail.at < 5000) return this._avail.ok;
    const ok = await this.lcu.isAvailable();
    this._avail = { at: Date.now(), ok };
    return ok;
  }

  async getCurrentPlayer() {
    const s = await this.lcu.get('/lol-summoner/v1/current-summoner');
    this._myPuuid = s.puuid;
    return { gameName: s.gameName, tagLine: s.tagLine, puuid: s.puuid };
  }

  async findPlayer(gameName, tagLine) {
    const q = new URLSearchParams({ gameName, tagLine });
    let r;
    try { r = await this.lcu.get(`/lol-summoner/v1/alias/lookup?${q}`); } catch (e) {
      if (e.status === 404) throw new Error(`"${gameName}#${tagLine}" bulunamadı (istemcinin bölgesinde arandı).`);
      throw e;
    }
    if (!r?.puuid) throw new Error(`"${gameName}#${tagLine}" bulunamadı.`);
    return { puuid: r.puuid, gameName: r.alias?.gameName || gameName, tagLine: r.alias?.tagLine || tagLine };
  }

  getSummoner(puuid) { return this.lcu.get(`/lol-summoner/v2/summoners/puuid/${puuid}`); }

  async getLeague(puuid) {
    if (!this._myPuuid) await this.getCurrentPlayer().catch(() => {});
    const r = await this.lcu.get(`/lol-ranked/v1/ranked-stats/${puuid}`);
    const out = [];
    for (const queueType of ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']) {
      const e = r?.queueMap?.[queueType];
      if (!e || UNRANKED.has(String(e.tier || '').toUpperCase())) continue;
      // İstemci başka oyuncuların mağlubiyet sayısını gizler (0 döner) → bilinmiyor olarak işaretle
      const hidden = !e.losses && e.wins > 0 && puuid !== this._myPuuid;
      out.push({
        queueType, tier: e.tier, rank: e.division && e.division !== 'NA' ? e.division : 'I',
        leaguePoints: e.leaguePoints || 0, wins: e.wins || 0, losses: hidden ? null : e.losses || 0,
      });
    }
    return out;
  }

  async _allMasteries(puuid) {
    if (!this.masteryCache.has(puuid)) {
      const p = this.lcu.get(`/lol-champion-mastery/v1/${puuid}/champion-mastery`)
        .then((list) => (Array.isArray(list) ? list : []).sort((a, b) => b.championPoints - a.championPoints))
        .catch(() => []);
      this.masteryCache.set(puuid, p);
    }
    return this.masteryCache.get(puuid);
  }
  async getTopMasteries(puuid, n = 5) { return (await this._allMasteries(puuid)).slice(0, n); }
  async getChampionMastery(puuid, championId) {
    return (await this._allMasteries(puuid)).find((m) => m.championId === championId) || null;
  }

  async getMatch(matchId) {
    if (!this.gameCache.has(matchId)) {
      const p = this.lcu.get(`/lol-match-history/v1/games/${matchId}`).then(lcuGameToV5);
      p.catch(() => this.gameCache.delete(matchId));
      this.gameCache.set(matchId, p);
    }
    return this.gameCache.get(matchId);
  }

  async getMatches(puuid, count, { full = false } = {}) {
    if (!count) return [];
    const r = await this.lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=${count - 1}`);
    const games = (r?.games?.games || []).sort((a, b) => b.gameCreation - a.gameCreation).slice(0, count);
    if (!full) return games.map(lcuGameToV5);
    // Tam maç (10 oyuncu) — öldürme katılımı ve maç detayı için
    return (await mapLimit(games, 5, (g) => this.getMatch(g.gameId).catch(() => lcuGameToV5(g))));
  }

  async getActiveGame({ live } = {}) {
    const [session, me] = await Promise.all([
      this.lcu.get('/lol-gameflow/v1/session').catch(() => null),
      this.getCurrentPlayer().catch(() => null),
    ]);
    const gd = session?.gameData;
    const queue = gd?.queue?.description || '';

    // 1) Oyun başladıysa (yükleme ekranı dahil) istemci 10 oyuncuyu PUUID ile verir
    if (['InProgress', 'Reconnect', 'GameStart'].includes(session?.phase) && (gd?.teamOne?.length || gd?.teamTwo?.length)) {
      const selections = Object.fromEntries((gd.playerChampionSelections || []).map((s) => [s.puuid || s.summonerInternalName, s.championId]));
      const map = (p, team) => ({
        riotId: p.gameName ? `${p.gameName}#${p.tagLine}` : (p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagLine}` : p.summonerName || p.puuid),
        puuid: p.puuid,
        team,
        championId: p.championId || selections[p.puuid] || selections[p.summonerInternalName] || undefined,
        position: p.selectedPosition,
      });
      const players = [...(gd.teamOne || []).map((p) => map(p, 'ORDER')), ...(gd.teamTwo || []).map((p) => map(p, 'CHAOS'))]
        .filter((p) => p.puuid);
      // Live Client verisi varsa şampiyon bilgisini oradan tamamla
      if (live) {
        for (const lp of live.allPlayers) {
          const pl = players.find((p) => p.riotId.toLowerCase() === analysis.riotIdOf(lp).toLowerCase());
          if (pl && !pl.championId) { pl.championName = lp.championName; pl.rawChampionName = lp.rawChampionName; }
          if (pl && !pl.position) pl.position = lp.position;
        }
      }
      if (players.length) {
        const myTeam = players.find((p) => p.puuid === me?.puuid)?.team || 'ORDER';
        return { players, myTeam, queue };
      }
    }

    // 2) Yedek: Live Client oyuncu listesi (PUUID sonra isimle aranır)
    if (live) {
      const snap = analysis.liveSnapshot(live, ddragon);
      return {
        players: live.allPlayers.map((p) => ({
          riotId: analysis.riotIdOf(p), team: p.team,
          championName: p.championName, rawChampionName: p.rawChampionName, position: p.position,
        })),
        myTeam: snap.myTeam, queue,
      };
    }
    return null;
  }
}

// ---------------- Riot API ----------------
class RiotProvider {
  constructor(riot) {
    this.riot = riot;
    this.name = 'riot';
    this.label = 'Riot API';
  }
  async available() { return !!this.riot.apiKey; }
  async getCurrentPlayer() { return null; }

  async findPlayer(gameName, tagLine) {
    try {
      const a = await this.riot.getAccountByRiotId(gameName, tagLine);
      return { puuid: a.puuid, gameName: a.gameName, tagLine: a.tagLine };
    } catch (e) {
      if (e.status === 404) throw new Error(`"${gameName}#${tagLine}" bulunamadı.`);
      throw e;
    }
  }
  getSummoner(puuid) { return this.riot.getSummonerByPuuid(puuid); }
  getLeague(puuid) { return this.riot.getLeagueEntries(puuid); }
  getTopMasteries(puuid, n = 5) { return this.riot.getTopMasteries(puuid, n); }
  getChampionMastery(puuid, championId) { return this.riot.getChampionMastery(puuid, championId); }
  getMatch(matchId) { return this.riot.getMatch(matchId); }
  async getMatches(puuid, count) {
    if (!count) return [];
    const ids = await this.riot.getMatchIds(puuid, { count });
    return (await Promise.all(ids.map((id) => this.riot.getMatch(id).catch(() => null)))).filter(Boolean);
  }

  async getActiveGame({ live, riotId } = {}) {
    const meId = live ? analysis.liveSnapshot(live, ddragon).me.riotId : riotId;
    if (meId) {
      try {
        const [g, t] = parseRiotId(meId);
        const acc = await this.riot.getAccountByRiotId(g, t);
        const game = await this.riot.getActiveGame(acc.puuid);
        if (game) {
          const toTeam = (id) => (id === 100 ? 'ORDER' : 'CHAOS');
          const meP = game.participants.find((p) => p.puuid === acc.puuid);
          return {
            players: game.participants.map((p) => ({ riotId: p.riotId, puuid: p.puuid, team: toTeam(p.teamId), championId: p.championId })),
            myTeam: toTeam(meP?.teamId ?? 100),
            queue: analysis.queueName(game.gameQueueConfigId),
          };
        }
      } catch { /* yedeğe düş */ }
    }
    if (live) {
      const snap = analysis.liveSnapshot(live, ddragon);
      return {
        players: live.allPlayers.map((p) => ({
          riotId: analysis.riotIdOf(p), team: p.team,
          championName: p.championName, rawChampionName: p.rawChampionName, position: p.position,
        })),
        myTeam: snap.myTeam, queue: '',
      };
    }
    return null;
  }
}

module.exports = { LcuProvider, RiotProvider, mapLimit };

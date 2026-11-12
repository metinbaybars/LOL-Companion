// Riot Games API istemcisi: hız limiti, 429 yeniden deneme ve maç önbelleği içerir.

const PLATFORM_TO_REGION = {
  br1: 'americas', la1: 'americas', la2: 'americas', na1: 'americas',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
  jp1: 'asia', kr: 'asia',
  eun1: 'europe', euw1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kayan pencere hız sınırlayıcı. Riot limitleri her yönlendirme değeri (tr1, europe...) için ayrıdır.
class RateLimiter {
  constructor(limits) {
    this.limits = limits; // [{ count, ms }]
    this.maxWindow = Math.max(...limits.map((l) => l.ms));
    this.stamps = [];
    this.chain = Promise.resolve();
  }
  schedule() {
    const p = this.chain.then(() => this._acquire());
    this.chain = p.catch(() => {});
    return p;
  }
  async _acquire() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.maxWindow);
      let wait = 0;
      for (const { count, ms } of this.limits) {
        const inWindow = this.stamps.filter((t) => now - t < ms);
        if (inWindow.length >= count) wait = Math.max(wait, inWindow[0] + ms - now + 10);
      }
      if (!wait) { this.stamps.push(now); return; }
      await sleep(wait);
    }
  }
}

class RiotApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class RiotApi {
  constructor({ apiKey, platform }) {
    this.apiKey = apiKey;
    this.platform = platform || 'tr1';
    this.limiters = new Map();
    this.matchCache = new Map();
    this.limits = [{ count: 20, ms: 1000 }, { count: 100, ms: 120000 }];
  }

  configure({ apiKey, platform }) {
    if (apiKey !== undefined && apiKey !== this.apiKey) { this.apiKey = apiKey; this.keyInvalid = false; }
    if (platform) this.platform = platform;
  }

  get region() { return PLATFORM_TO_REGION[this.platform] || 'europe'; }
  // account-v1 'sea' desteklemez
  get accountRegion() { return this.region === 'sea' ? 'asia' : this.region; }

  _limiter(host) {
    if (!this.limiters.has(host)) this.limiters.set(host, new RateLimiter(this.limits));
    return this.limiters.get(host);
  }

  async request(host, path, { allow404 = false } = {}) {
    if (!this.apiKey) throw new RiotApiError(0, 'API anahtarı girilmemiş. Ayarlar sekmesinden ekleyin.');
    const url = `https://${host}.api.riotgames.com${path}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this._limiter(host).schedule();
      let res;
      try {
        res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } });
      } catch (e) {
        throw new RiotApiError(0, `Ağ hatası: ${e.message}`);
      }
      if (res.ok) return res.json();
      if (res.status === 404 && allow404) return null;
      if (res.status === 429 || res.status === 503) {
        const retry = Number(res.headers.get('retry-after')) || 2;
        await sleep(retry * 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        this.keyInvalid = true; // anahtar değişene kadar tekrar deneme
        throw new RiotApiError(res.status, 'API anahtarı geçersiz veya süresi dolmuş. developer.riotgames.com adresinden yenileyin.');
      }
      if (res.status === 404) throw new RiotApiError(404, 'Bulunamadı.');
      throw new RiotApiError(res.status, `Riot API hatası (${res.status}).`);
    }
    throw new RiotApiError(429, 'Hız limiti aşıldı, biraz sonra tekrar deneyin.');
  }

  // ---- Endpointler ----
  getAccountByRiotId(gameName, tagLine) {
    return this.request(this.accountRegion,
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }
  getAccountByPuuid(puuid) {
    return this.request(this.accountRegion, `/riot/account/v1/accounts/by-puuid/${puuid}`);
  }
  getSummonerByPuuid(puuid) {
    return this.request(this.platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`);
  }
  getLeagueEntries(puuid) {
    return this.request(this.platform, `/lol/league/v4/entries/by-puuid/${puuid}`);
  }
  getTopMasteries(puuid, count = 5) {
    return this.request(this.platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`);
  }
  getChampionMastery(puuid, championId) {
    return this.request(this.platform,
      `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/by-champion/${championId}`, { allow404: true });
  }
  getMatchIds(puuid, { start = 0, count = 20, queue } = {}) {
    const q = new URLSearchParams({ start, count });
    if (queue) q.set('queue', queue);
    return this.request(this.region, `/lol/match/v5/matches/by-puuid/${puuid}/ids?${q}`);
  }
  async getMatch(matchId) {
    if (this.matchCache.has(matchId)) return this.matchCache.get(matchId);
    const m = await this.request(this.region, `/lol/match/v5/matches/${matchId}`);
    this.matchCache.set(matchId, m);
    if (this.matchCache.size > 1000) this.matchCache.delete(this.matchCache.keys().next().value);
    return m;
  }
  getActiveGame(puuid) {
    return this.request(this.platform, `/lol/spectator/v5/active-games/by-summoner/${puuid}`, { allow404: true });
  }
}

// League istemcisinden kopyalanan isimlerde görünmez yön/biçim karakterleri olur (U+2066..2069, U+200B..200F vb.)
const cleanText = (str) => String(str || '').replace(/[​-‏‪-‮⁠-⁩﻿]/g, '').trim();

function parseRiotId(str) {
  const s = cleanText(str);
  const i = s.lastIndexOf('#');
  if (i <= 0 || i === s.length - 1) throw new RiotApiError(0, 'Riot ID "Ad#TAG" biçiminde olmalı.');
  return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
}

module.exports = { RiotApi, RiotApiError, parseRiotId, cleanText, PLATFORM_TO_REGION };

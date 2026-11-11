// Data Dragon: şampiyon/eşya isimleri ve görselleri için statik veri.

const BASE = 'https://ddragon.leagueoflegends.com';

const state = {
  version: null,
  champsByKey: {},   // "103" -> { id: "Ahri", name: "Ahri" }
  champsByLookup: {}, // normalize edilmiş isim/id -> champ
  items: {},          // "3031" -> { name, gold }
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ğüşöçı]/g, '');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DDragon ${res.status}`);
  return res.json();
}

let loading = null;
function load() {
  if (!loading) {
    loading = (async () => {
      const versions = await getJson(`${BASE}/api/versions.json`);
      state.version = versions[0];
      const [en, tr, items] = await Promise.all([
        getJson(`${BASE}/cdn/${state.version}/data/en_US/champion.json`),
        getJson(`${BASE}/cdn/${state.version}/data/tr_TR/champion.json`).catch(() => null),
        getJson(`${BASE}/cdn/${state.version}/data/tr_TR/item.json`),
      ]);
      for (const c of Object.values(en.data)) {
        const trName = tr?.data?.[c.id]?.name || c.name;
        const champ = { key: Number(c.key), id: c.id, name: trName };
        state.champsByKey[c.key] = champ;
        for (const n of [c.id, c.name, trName]) state.champsByLookup[norm(n)] = champ;
      }
      for (const [id, it] of Object.entries(items.data)) {
        state.items[id] = { name: it.name, gold: it.gold?.total || 0 };
      }
      return state;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// Live Client: championName yerelleştirilmiş, rawChampionName = "game_character_displayname_MonkeyKing"
function resolveChampion({ championId, championName, rawChampionName } = {}) {
  if (championId && state.champsByKey[championId]) return state.champsByKey[championId];
  if (rawChampionName) {
    const id = String(rawChampionName).replace('game_character_displayname_', '');
    if (state.champsByLookup[norm(id)]) return state.champsByLookup[norm(id)];
  }
  return state.champsByLookup[norm(championName)] || null;
}

function publicData() {
  return { version: state.version, champsByKey: state.champsByKey, items: state.items };
}

module.exports = { load, resolveChampion, publicData, state };

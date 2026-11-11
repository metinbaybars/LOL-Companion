# LoL Companion

League of Legends için masaüstü yardımcı uygulama. League istemcisi açıkken arka planda çalışır:
profilini, maç geçmişini ve oyuna girdiğinde rakip takımın analizini gösterir. **API anahtarı veya hesap gerekmez.**

## İndir ve kullan

1. [Releases](../../releases) sayfasından son sürümü indir:
   - `LoL-Companion-Setup-x.y.z.exe` — kurulum sihirbazı (masaüstü kısayolu ile), ya da
   - `LoL-Companion-x.y.z-portable.exe` — kurulumsuz, tek dosya.
2. League of Legends istemcisini aç ve giriş yap.
3. LoL Companion'ı aç. Profilin otomatik gelir; maç yüklenince **Canlı Oyun** sekmesi kendiliğinden açılır.

> Uygulama imzasız olduğu için Windows "Bilgisayarınız korundu" uyarısı verebilir:
> **Ek bilgi → Yine de çalıştır**.

## Özellikler

- **Profil**: dereceli (Tek/Çift + Esnek), son maç istatistikleri (kazanma oranı, KDA, CS/dk, öldürme katılımı), form, ana rol, en çok oynanan şampiyonlar, ustalıklar. Herhangi bir oyuncuyu Riot ID ile arayabilirsin.
- **Maç geçmişi**: zafer/bozgun, KDA, CS, eşyalar; tıklayınca 10 oyunculu detay.
- **Rakip takım analizi** (yükleme ekranında otomatik başlar): her oyuncunun derecesi, son formu, oynadığı şampiyondaki deneyimi ve ustalığı, tehdit puanı ve etiketler (OTP, Uzman, Seri, Çok ölüyor, Ana rolü dışında…). Takım ortalaması ve en tehlikeli oyuncu.
- **Canlı skor tablosu**: süre, skor, kule/ejder/baron/larva, eşya altını farkı, tüm oyuncuların KDA/CS/eşya/ölüm süresi (2 sn'de bir güncellenir).
- **Oyun içi pencere**: oyundayken kısayol tuşuyla (varsayılan **Alt+X**) açılan küçük panel. Rakiplerin derecesi, tehdit puanı, etiketleri, canlı KDA'sı ve ölüm sayaçları; skor, süre ve altın farkı. Tıklamaları oyuna geçirir, odağı çalmaz. Tuş, konum ve koyuluk Ayarlar'dan değiştirilebilir.
  > League'de **Ayarlar → Video → Pencere Modu** "Çerçevesiz" ya da "Pencere" olmalı. "Tam ekran" modunda hiçbir uygulama oyunun üstünde görünemez.
- İsteğe bağlı "her zaman üstte" penceresi.

## Nasıl çalışır

| Kaynak | Ne için | Anahtar |
|---|---|---|
| League istemcisinin yerel API'si (LCU) | Profil, derece, ustalık, maç geçmişi, oyundaki 10 oyuncu | Gerekmez |
| Live Client Data API (`127.0.0.1:2999`) | Canlı skor, eşyalar, olaylar | Gerekmez |
| Data Dragon | Şampiyon/eşya isim ve görselleri | Gerekmez |
| Riot API (isteğe bağlı) | İstemci kapalıyken arama | Kullanıcının kendi anahtarı |

Tüm veriler senin bilgisayarında, senin istemcinden okunur; hiçbir sunucuya gönderilmez.
Arama, istemcinin bağlı olduğu bölgedeki oyuncularla sınırlıdır.

## Geliştirme

```bash
npm install
npm start      # uygulamayı çalıştır
npm run dist   # dist/ içinde kurulum + taşınabilir .exe üret
npm run dist:local  # Windows "sembolik bağlantı" izin hatası alırsan bunu kullan
```

Yeni sürüm yayınlamak: `package.json` içindeki `version`'ı artır, sonra

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions .exe'leri derleyip Releases sayfasına otomatik yükler ([.github/workflows/release.yml](.github/workflows/release.yml)).

```
main.js             Electron ana süreç, kaynak seçimi, otomatik oyun algılama
src/lcu.js          League istemcisine bağlantı (port + parola istemci sürecinden okunur)
src/providers.js    Veri sağlayıcıları: istemci (varsayılan) ve Riot API (isteğe bağlı)
src/riot-api.js     Riot API istemcisi (hız limiti, yeniden deneme)
src/live-client.js  Oyun içi canlı veri dinleyicisi
src/analysis.js     İstatistik, etiketler, tehdit puanı, canlı skor
src/ddragon.js      Şampiyon/eşya statik verisi
renderer/           Arayüz
```

## Notlar

- Riot API anahtarını **asla** koda veya repoya koyma. Geliştirme anahtarı kişiseldir ve 24 saatte sona erer.
- Uygulama yalnızca oyun başladıktan sonra herkese açık bilgileri kullanır; dereceli şampiyon seçiminde gizlenen isimleri açığa çıkarmaz.
- League istemcisinin yerel API'si Riot tarafından resmi olarak desteklenmez; istemci güncellemeleri bazı özellikleri bozabilir.

---

LoL Companion isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

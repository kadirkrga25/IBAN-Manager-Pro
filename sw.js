/**
 * IBAN Manager Pro — Service Worker v3.0
 * ═══════════════════════════════════════════════════════════════
 *
 * STRATEJİ:
 *   • App Shell (HTML/CSS/JS/İkonlar) → Cache First
 *   • Navigasyon istekleri           → Cache First → Network → Offline
 *   • Statik varlıklar               → Cache First (kalıcı)
 *   • Bilinmeyenler                  → Stale-While-Revalidate
 *
 * VERSİYONLAMA:
 *   CACHE_VERSION değerini her deploy'da artır.
 *   Eski cache'ler activate aşamasında otomatik silinir.
 *
 * ÇALIŞMA MANTIĞI:
 *   1. install  → App shell precache (skipWaiting ile anında aktif)
 *   2. activate → Eski cache sil, tüm client'ları claim et
 *   3. fetch    → Strateji yönlendirici
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ── Versiyon — her deployment'ta artır ── */
const CACHE_VERSION = 'v3.0.0';
const CACHE_NAME    = `iban-pro-${CACHE_VERSION}`;
const OFFLINE_URL   = './index.html';

/* ── App Shell: ilk kurulumda mutlaka cache'lenmesi gereken dosyalar ── */
const PRECACHE_ASSETS = [
  /* Sayfa çatısı — tek dosyalı (inline CSS/JS) uygulama */
  './',
  './index.html',

  /* PWA meta */
  './manifest.json',

  /* İkonlar — Ana Ekran / Splash için zorunlu */
  './icons/favicon.ico',
  './icons/favicon-32x32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-180x180.png',
  './icons/icon-192x192.png',
  './icons/icon-256x256.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png',

  /* Splash Screens (iOS) */
  './icons/splash/splash-640x1136.png',
  './icons/splash/splash-750x1334.png',
  './icons/splash/splash-1242x2208.png',
  './icons/splash/splash-1125x2436.png',
  './icons/splash/splash-828x1792.png',
  './icons/splash/splash-1242x2688.png',
  './icons/splash/splash-1170x2532.png',
  './icons/splash/splash-1284x2778.png',
  './icons/splash/splash-2048x2732.png',
];

/* ════════════════════════════════════════════
   INSTALL — App Shell'i önbelleğe al
   ════════════════════════════════════════════ */
self.addEventListener('install', event => {
  console.log(`[SW] install — ${CACHE_NAME}`);

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      /* Her dosyayı tek tek ekle: biri 404 dönse diğerleri etkilenmesin */
      const promises = PRECACHE_ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch(err => console.warn(`[SW] Precache atlandı: ${url}`, err.message))
      );
      return Promise.all(promises);
    }).then(() => {
      console.log(`[SW] App shell cache'lendi — ${CACHE_NAME}`);
      /* Bekleme yapmadan hemen devral: yeni SW anında aktif */
      return self.skipWaiting();
    })
  );
});

/* ════════════════════════════════════════════
   ACTIVATE — Eski cache'leri temizle
   ════════════════════════════════════════════ */
self.addEventListener('activate', event => {
  console.log(`[SW] activate — ${CACHE_NAME}`);

  event.waitUntil(
    Promise.all([

      /* 1. Eski cache versiyonlarını sil */
      caches.keys().then(keys => {
        const stale = keys.filter(k => k.startsWith('iban-pro-') && k !== CACHE_NAME);
        if (stale.length) console.log('[SW] Eski cache\'ler siliniyor:', stale);
        return Promise.all(stale.map(k => caches.delete(k)));
      }),

      /* 2. Tüm açık sekmeleri/pencereleri bu SW ile kontrol altına al */
      self.clients.claim(),

    ]).then(() => {
      console.log('[SW] Aktif — tüm client\'lar kontrol altında');
      /* Tüm sekmelere "güncellendi" mesajı gönder */
      return self.clients.matchAll({ type: 'window' }).then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }))
      );
    })
  );
});

/* ════════════════════════════════════════════
   FETCH — İstek yönlendirici
   ════════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  /* Yalnızca aynı origin'i yakala */
  if (url.origin !== self.location.origin) return;

  /* GET dışındaki istekleri pas geç (POST vb.) */
  if (req.method !== 'GET') return;

  /* chrome-extension vb. protokolleri atla */
  if (!url.protocol.startsWith('http')) return;

  /* ─── Strateji seçimi ─── */

  /* Navigasyon (HTML sayfa yüklemeleri) */
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  /* App Shell dosyaları → Cache First */
  if (isAppShell(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* İkonlar & Splash → Cache First (uzun ömürlü) */
  if (url.pathname.includes('/icons/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* Diğer her şey → Stale-While-Revalidate */
  event.respondWith(staleWhileRevalidate(req));
});

/* ────────────────────────────────────────────
   STRATEJİ: Cache First
   Önce cache'e bak. Yoksa network'ten al, cache'e ekle.
   Network yoksa offline fallback.
   ──────────────────────────────────────────── */
async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: false });
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (response.ok && response.status < 400) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(req);
  }
}

/* ────────────────────────────────────────────
   STRATEJİ: Stale-While-Revalidate
   Cache varsa hemen döndür, arka planda güncelle.
   ──────────────────────────────────────────── */
async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  /* Arka planda güncelleme başlat */
  const networkPromise = fetch(req).then(response => {
    if (response.ok && response.status < 400) {
      cache.put(req, response.clone());
    }
    return response;
  }).catch(() => null);

  /* Cache varsa hemen döndür, yoksa ağı bekle */
  if (cached) return cached;

  const fresh = await networkPromise;
  return fresh || offlineFallback(req);
}

/* ────────────────────────────────────────────
   Navigasyon handler
   SPA (Single Page App) için tüm navigasyonu
   index.html'e yönlendir.
   ──────────────────────────────────────────── */
async function handleNavigate(req) {
  /* Önce cache'te tam URL var mı? */
  const urlMatch = await caches.match(req);
  if (urlMatch) return urlMatch;

  /* Network'ten dene */
  try {
    const response = await fetch(req);
    if (response.ok) {
      /* Başarılıysa cache'e ekle */
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, response.clone());
      return response;
    }
  } catch {
    /* Network yok */
  }

  /* Cache'ten index.html veya kök */
  const indexMatch =
    await caches.match('./index.html') ||
    await caches.match('./') ||
    await caches.match(new Request('./index.html'));

  if (indexMatch) return indexMatch;

  /* Son çare: Offline sayfası (index.html'in kendisi, SPA fallback) */
  return caches.match(OFFLINE_URL) ||
    new Response('<h1>Çevrimdışı</h1>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

/* ────────────────────────────────────────────
   Offline fallback
   ──────────────────────────────────────────── */
async function offlineFallback(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  const accepts = req.headers.get('Accept') || '';
  if (accepts.includes('text/html')) {
    return caches.match(OFFLINE_URL) ||
      new Response('<h1>Çevrimdışı</h1>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
  }

  return new Response('', { status: 503, statusText: 'Offline' });
}

/* ────────────────────────────────────────────
   App Shell URL kontrolü
   ──────────────────────────────────────────── */
function isAppShell(pathname) {
  const shell = ['/', '/index.html', '/manifest.json'];
  return shell.some(s => pathname === s || pathname.endsWith(s));
}

/* ════════════════════════════════════════════
   BACKGROUND SYNC
   İnternet geldiğinde otomatik senkronizasyon
   (Desteklenen tarayıcılarda aktif)
   ════════════════════════════════════════════ */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-iban-data') {
    console.log('[SW] Background sync: iban-data');
    event.waitUntil(syncIBANData());
  }
});

async function syncIBANData() {
  /*
   * IBAN Manager Pro tamamen localStorage tabanlı çalışır.
   * Tüm CRUD işlemleri zaten offline yapılır (state.js).
   * Bu stub, ileride CloudKit / backend entegrasyonu için hazırdır.
   *
   * CloudKit entegrasyonu geldiğinde buraya:
   *   - IndexedDB'den bekleyen değişiklikleri al
   *   - CKModifyRecordsOperation ile gönder
   *   - Başarılıysa "synced" flag'ini güncelle
   */
  console.log('[SW] IBAN verisi sync tamamlandı (offline-first, veri localStorage\'da)');
}

/* ════════════════════════════════════════════
   PUSH NOTIFICATIONS
   iOS 16.4+ ve Android Chrome'da çalışır.
   HTTPS zorunludur.
   ════════════════════════════════════════════ */
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'IBAN Manager Pro', body: event.data.text() };
  }

  const options = {
    body   : payload.body   || 'Yeni bildirim',
    icon   : './icons/icon-192x192.png',
    badge  : './icons/icon-72x72.png',
    tag    : payload.tag    || 'iban-notification',
    data   : payload.data   || {},
    vibrate: [100, 50, 100],
    requireInteraction: false,
    silent : false,
  };

  event.waitUntil(
    self.registration.showNotification(
      payload.title || 'IBAN Manager Pro',
      options
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        /* Zaten açık bir pencere varsa odakla */
        for (const client of clients) {
          if ('focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return client.focus();
          }
        }
        /* Yoksa yeni pencere */
        return self.clients.openWindow(targetUrl);
      })
  );
});

/* ════════════════════════════════════════════
   MESSAGE — Ana thread iletişimi
   ════════════════════════════════════════════ */
self.addEventListener('message', event => {
  const msg = event.data || {};
  console.log('[SW] Mesaj alındı:', msg.type);

  switch (msg.type) {

    /* Yeni SW'yi bekleme olmadan aktifleştir */
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    /* Belirli URL'leri runtime'da cache'e ekle */
    case 'CACHE_URLS':
      if (Array.isArray(msg.urls)) {
        event.waitUntil(
          caches.open(CACHE_NAME).then(cache =>
            Promise.all(
              msg.urls.map(u =>
                cache.add(u).catch(e => console.warn('[SW] Cache URL hatası:', u, e.message))
              )
            )
          )
        );
      }
      break;

    /* Mevcut cache'i temizle (debug / reset için) */
    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.delete(CACHE_NAME).then(ok =>
          event.source?.postMessage({ type: 'CACHE_CLEARED', ok })
        )
      );
      break;

    /* SW versiyon bilgisi */
    case 'GET_VERSION':
      event.source?.postMessage({
        type   : 'SW_VERSION',
        version: CACHE_VERSION,
        cache  : CACHE_NAME,
      });
      break;

    /* Cache listesi (debug) */
    case 'GET_CACHE_LIST':
      caches.open(CACHE_NAME).then(cache => cache.keys()).then(keys => {
        event.source?.postMessage({
          type : 'CACHE_LIST',
          count: keys.length,
          urls : keys.map(r => r.url),
        });
      });
      break;
  }
});

/* ════════════════════════════════════════════
   PERIODIC BACKGROUND SYNC (deneysel)
   Chrome Android'de arka planda güncelleme
   ════════════════════════════════════════════ */
self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-iban-cache') {
    event.waitUntil(updateCacheInBackground());
  }
});

async function updateCacheInBackground() {
  try {
    const cache = await caches.open(CACHE_NAME);
    /* App shell'i arka planda tazele */
    await Promise.allSettled(
      ['./', './index.html']
        .map(url =>
          fetch(new Request(url, { cache: 'reload' }))
            .then(r => { if (r.ok) cache.put(url, r); })
            .catch(() => {})
        )
    );
    console.log('[SW] Arka plan güncelleme tamamlandı');
  } catch (e) {
    console.warn('[SW] Arka plan güncelleme hatası:', e);
  }
}

console.log(`[SW] IBAN Manager Pro Service Worker ${CACHE_VERSION} yüklendi`);

/* ══════════════════════════════════════════════════════════════
   BENCHONE — Service Worker (offline + AUTO-ACTUALIZACIÓN v6)

   ▓▓▓ IMPORTANTE — CADA VEZ QUE PUBLIQUES CAMBIOS ▓▓▓
   Subí el número de CACHE_VERSION (v6 → v7 ...).

   NOVEDAD v6: el index.html ahora es NETWORK-FIRST. La app intenta
   siempre traer la versión más nueva de la red al abrir; si no hay
   internet, usa la copia guardada. Esto hace que las actualizaciones
   aparezcan solas, sin tener que borrar caché a mano.
   ══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'benchone-v6';
const NET_TIMEOUT_MS = 4000;
const LIB_CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];
const APP_SHELL = ['./', './index.html', './logo.png', 'index.html'];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return Promise.all(APP_SHELL.map(function(url){
        return cache.add(new Request(url, { cache: 'reload' })).catch(function(){
          return cache.add(url).catch(function(){});
        });
      }));
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Permite que la página pida activar de inmediato una versión nueva.
self.addEventListener('message', function(event){
  if(event.data === 'skipWaiting'){ self.skipWaiting(); }
});

function fetchConTimeout(req){
  return new Promise(function(resolve, reject){
    var listo = false;
    var timer = setTimeout(function(){
      if(!listo){ listo = true; reject(new Error('net-timeout')); }
    }, NET_TIMEOUT_MS);
    fetch(req).then(function(res){
      clearTimeout(timer);
      try{
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function(cache){ cache.put(req, copy).catch(function(){}); });
      }catch(e){}
      if(!listo){ listo = true; resolve(res); }
    }).catch(function(err){
      clearTimeout(timer);
      if(!listo){ listo = true; reject(err); }
    });
  });
}

function indexGuardado(){
  return caches.open(CACHE_VERSION).then(function(cache){
    return cache.match('./index.html')
      .then(function(h){ return h || cache.match('index.html'); })
      .then(function(h){ return h || cache.match('./'); });
  });
}

self.addEventListener('fetch', function(event){
  const req = event.request;
  if(req.method !== 'GET'){ return; }
  const url = new URL(req.url);

  // Librerías de CDN: cache-first (no cambian, así cargan rápido y offline).
  if(LIB_CDN_HOSTS.indexOf(url.hostname) !== -1){
    event.respondWith(
      caches.match(req).then(function(hit){
        if(hit) return hit;
        return fetch(req).then(function(res){
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function(cache){ cache.put(req, copy).catch(function(){}); });
          return res;
        });
      })
    );
    return;
  }

  // Otros orígenes (Supabase, fuentes): directo a la red.
  if(url.origin !== self.location.origin){ return; }

  // NAVEGACIÓN (abrir la app): NETWORK-FIRST.
  // Intentamos SIEMPRE traer el index fresco de la red (así aparece lo nuevo).
  // Si la red falla o tarda, usamos la copia guardada (para que abra offline).
  if(req.mode === 'navigate'){
    event.respondWith(
      fetchConTimeout(req).catch(function(){
        return indexGuardado().then(function(g){ return g || fetch(req); });
      })
    );
    return;
  }

  // Resto de recursos del mismo origen: network-first con respaldo a caché.
  event.respondWith(
    fetchConTimeout(req).catch(function(){
      return caches.match(req).then(function(hit){
        if(hit) return hit;
        return indexGuardado().then(function(g){ return g || fetch(req); });
      });
    })
  );
});

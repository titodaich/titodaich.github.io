/* ══════════════════════════════════════════════════════════════
   BENCHONE — Service Worker (offline BLINDADO)

   ▓▓▓ IMPORTANTE — CADA VEZ QUE PUBLIQUES CAMBIOS ▓▓▓
   Subí el número de CACHE_VERSION (v4 → v5 → v6 ...).
   Si no lo cambiás, los usuarios que ya instalaron la app pueden
   seguir viendo la versión vieja guardada en su teléfono.

   Este SW está diseñado para que NUNCA muestre el error
   "no estás conectado a Internet" por su culpa: ante cualquier
   fallo de red, sirve la copia guardada, y si no la tiene, va a
   la red directo. Nunca devuelve una respuesta vacía.
   ══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'benchone-v4';

// Cuánto esperamos a la red antes de abrir la copia guardada (ms).
// Evita que la app instalada se cuelgue al abrir con señal lenta.
const NET_TIMEOUT_MS = 3500;

const LIB_CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];
const APP_SHELL = ['./', './index.html', './logo.png'];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return Promise.all(APP_SHELL.map(function(url){
        return cache.add(url).catch(function(){});
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

// fetch con timeout: se rinde si la red tarda más de NET_TIMEOUT_MS,
// pero igual guarda la respuesta si llega tarde (para el próximo offline).
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

self.addEventListener('fetch', function(event){
  const req = event.request;
  if(req.method !== 'GET'){ return; }
  const url = new URL(req.url);

  // Librerías de CDN (Supabase, jszip, xlsx): cache-first.
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

  // Otros orígenes (Supabase datos/login, fuentes): directo a la red.
  if(url.origin !== self.location.origin){ return; }

  // NAVEGACIÓN (abrir la app): BLINDADO — nunca devuelve vacío.
  if(req.mode === 'navigate'){
    event.respondWith(
      fetchConTimeout(req).catch(function(){
        return caches.match(req).then(function(hit){
          if(hit) return hit;
          return caches.match('./index.html').then(function(idx){
            if(idx) return idx;
            return fetch(req); // último recurso: red sin timeout
          });
        });
      })
    );
    return;
  }

  // Resto de recursos del mismo origen (css/js/img): network-first con timeout,
  // con respaldo a cache y, si no hay, a la red directo.
  event.respondWith(
    fetchConTimeout(req).catch(function(){
      return caches.match(req).then(function(hit){
        if(hit) return hit;
        return fetch(req).catch(function(){ return caches.match('./index.html'); });
      });
    })
  );
});

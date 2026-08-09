/* ══════════════════════════════════════════════════════════════
   BENCHONE — Service Worker (offline BLINDADO v5)

   ▓▓▓ IMPORTANTE — CADA VEZ QUE PUBLIQUES CAMBIOS ▓▓▓
   Subí el número de CACHE_VERSION (v5 → v6 ...).

   Diseñado para que la app instalada en iPhone ABRA por datos
   móviles: cachea el HTML de forma agresiva apenas se instala,
   así no depende de bajarlo por la red. Y ante cualquier fallo
   NUNCA devuelve vacío (que disparaba "no conectado a Internet").
   ══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'benchone-v5';
const NET_TIMEOUT_MS = 3500;
const LIB_CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

// Guardamos el index con varias claves para que SIEMPRE haya un respaldo,
// sin importar cómo pida la navegación el sistema.
const APP_SHELL = ['./', './index.html', './logo.png', 'index.html'];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      // Cacheamos el shell. Además, forzamos guardar el index pidiéndolo a la red
      // con cache:'reload' para asegurar una copia fresca guardada desde el arranque.
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

// Devuelve el index guardado por cualquiera de sus claves.
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

  // Librerías de CDN: cache-first.
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

  // NAVEGACIÓN (abrir la app): CACHE-FIRST para el index.
  // Cambio clave para iPhone por datos: primero servimos el index GUARDADO
  // (instantáneo, sin depender de la red), y actualizamos en segundo plano.
  // Así la app instalada abre siempre, aunque los datos estén lentos o cortados.
  if(req.mode === 'navigate'){
    event.respondWith(
      indexGuardado().then(function(guardado){
        if(guardado){
          // Servimos lo guardado YA, y refrescamos la copia por detrás.
          fetchConTimeout(req).catch(function(){});
          return guardado;
        }
        // No hay copia guardada aún: intentamos la red, con respaldo final.
        return fetchConTimeout(req).catch(function(){
          return indexGuardado().then(function(g){ return g || fetch(req); });
        });
      })
    );
    return;
  }

  // Resto de recursos del mismo origen: network-first con timeout y respaldo.
  event.respondWith(
    fetchConTimeout(req).catch(function(){
      return caches.match(req).then(function(hit){
        if(hit) return hit;
        return indexGuardado().then(function(g){ return g || fetch(req); });
      });
    })
  );
});

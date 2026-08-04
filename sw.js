/* ══════════════════════════════════════════════════════════════
   BENCHONE — Service Worker (offline + versionado)

   ▓▓▓ IMPORTANTE — CADA VEZ QUE PUBLIQUES CAMBIOS ▓▓▓
   Subí el número de CACHE_VERSION (v1 → v2 → v3 ...).
   Si no lo cambiás, los usuarios que ya instalaron la app pueden
   seguir viendo la versión vieja guardada en su teléfono.
   Es el único mantenimiento que pide el offline.
   ══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'benchone-v1';

// Archivos que forman "la app". Se guardan para que abra sin internet.
const APP_SHELL = [
  './',
  './index.html',
  './logo.png'
];

// Al instalar: guardamos la app en el cache.
self.addEventListener('install', function(event){
  self.skipWaiting(); // activa la versión nueva enseguida
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      // addAll falla si un archivo no existe; lo hacemos tolerante.
      return Promise.all(APP_SHELL.map(function(url){
        return cache.add(url).catch(function(){ /* si un archivo no está, seguimos */ });
      }));
    })
  );
});

// Al activar: borramos caches viejos (versiones anteriores).
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Estrategia de red:
//  - Peticiones a Supabase / APIs externas: SIEMPRE de la red (nunca cache).
//    Así los datos están siempre frescos y no rompemos el login/guardado.
//  - La app en sí (html/css/js/img del mismo origen): "network-first" con
//    respaldo a cache. Si hay internet, ve lo último; si no, abre lo guardado.
self.addEventListener('fetch', function(event){
  const req = event.request;

  // Solo GET; el resto (POST a Supabase, etc.) pasa directo a la red.
  if(req.method !== 'GET'){ return; }

  const url = new URL(req.url);

  // Todo lo que no sea de nuestro propio origen (Supabase, fuentes de Google,
  // etc.) pasa directo a la red, sin tocar el cache.
  if(url.origin !== self.location.origin){
    return; // el navegador maneja la petición normalmente
  }

  // App del mismo origen: network-first con respaldo a cache.
  event.respondWith(
    fetch(req).then(function(res){
      // Guardamos una copia fresca para el próximo offline.
      const copy = res.clone();
      caches.open(CACHE_VERSION).then(function(cache){
        cache.put(req, copy).catch(function(){});
      });
      return res;
    }).catch(function(){
      // Sin internet: servimos lo guardado. Si es una navegación, el index.
      return caches.match(req).then(function(hit){
        return hit || caches.match('./index.html');
      });
    })
  );
});

/* ══════════════════════════════════════════════════════════════
   BENCHONE — Service Worker (offline + versionado)

   ▓▓▓ IMPORTANTE — CADA VEZ QUE PUBLIQUES CAMBIOS ▓▓▓
   Subí el número de CACHE_VERSION (v1 → v2 → v3 ...).
   Si no lo cambiás, los usuarios que ya instalaron la app pueden
   seguir viendo la versión vieja guardada en su teléfono.
   Es el único mantenimiento que pide el offline.
   ══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'benchone-v3';

// Cuánto esperamos a la red antes de abrir la copia guardada (en ms).
// Esto es lo que evita que la APP INSTALADA se quede colgada al abrir
// cuando la señal de datos móviles es lenta o hace un microcorte:
// si en este tiempo la red no respondió, servimos lo guardado y la app
// abre igual. Con wifi rápido, la red gana siempre y ni se nota.
const NET_TIMEOUT_MS = 3500;

// CDNs de librerías (Supabase, jszip, xlsx). Se cachean con "cache-first": la
// primera vez que cargan bien quedan guardadas, y después cargan al instante sin
// depender de bajarlas de nuevo. Esto evita el error "no se pudo cargar el servicio
// de acceso" cuando la app instalada abre con señal intermitente.
const LIB_CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

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

// Helper: hace un fetch que "se rinde" si la red tarda más de NET_TIMEOUT_MS.
// Devuelve la respuesta de red si llega a tiempo; si no, rechaza para que
// el que llama pueda ir al cache. No aborta la descarga real: si termina un
// poco después, igual la guardamos para la próxima.
function fetchConTimeout(req){
  return new Promise(function(resolve, reject){
    var listo = false;
    var timer = setTimeout(function(){
      if(!listo){ listo = true; reject(new Error('net-timeout')); }
    }, NET_TIMEOUT_MS);

    fetch(req).then(function(res){
      clearTimeout(timer);
      // Guardamos una copia fresca aunque el timeout ya haya disparado.
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

// Estrategia de red:
//  - Peticiones a Supabase / APIs externas: SIEMPRE de la red (nunca cache).
//    Así los datos están siempre frescos y no rompemos el login/guardado.
//  - La app en sí (html/css/js/img del mismo origen): "network-first con
//    TIMEOUT" con respaldo a cache. Si hay internet rápido, ve lo último;
//    si la red tarda (datos móviles flojos) o no hay, abre lo guardado.
self.addEventListener('fetch', function(event){
  const req = event.request;

  // Solo GET; el resto (POST a Supabase, etc.) pasa directo a la red.
  if(req.method !== 'GET'){ return; }

  const url = new URL(req.url);

  // Librerías de CDN (Supabase-js, jszip, xlsx): cache-first. Si ya están guardadas,
  // se usan al instante (aunque la señal sea mala); si no, se bajan y se guardan.
  // Esto es lo que evita que la app instalada falle al cargar el login.
  if(LIB_CDN_HOSTS.indexOf(url.hostname) !== -1){
    event.respondWith(
      caches.match(req).then(function(hit){
        if(hit) return hit;   // ya guardada: al instante
        return fetch(req).then(function(res){
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function(cache){ cache.put(req, copy).catch(function(){}); });
          return res;
        });
      })
    );
    return;
  }

  // Todo lo demás que no sea de nuestro propio origen (Supabase datos/login, fuentes
  // de Google, etc.) pasa directo a la red, sin tocar el cache. Así los datos y el
  // login están siempre frescos.
  if(url.origin !== self.location.origin){
    return; // el navegador maneja la petición normalmente
  }

  // App del mismo origen: network-first CON TIMEOUT y respaldo a cache.
  // Si la red responde a tiempo → versión fresca (y se guarda copia).
  // Si la red tarda demasiado o falla → abrimos lo guardado; si es una
  // navegación y no hay copia exacta, caemos al index.html guardado.
  event.respondWith(
    fetchConTimeout(req).catch(function(){
      return caches.match(req).then(function(hit){
        if(hit) return hit;
        if(req.mode === 'navigate') return caches.match('./index.html');
        return caches.match('./index.html'); // último respaldo razonable
      });
    })
  );
});

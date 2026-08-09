/* ══════════════════════════════════════════════════════════════
   BENCHONE — Service Worker NEUTRALIZADO (auto-desinstalable)

   El offline por service worker causaba, en iPhone, que la app
   instalada mostrara "no estás conectado a Internet" aunque
   hubiera señal (un SW viejo quedaba atascado). Como la app
   necesita internet igual (login y datos en la nube), lo quitamos.

   Este archivo YA NO cachea nada. Su única función es LIMPIAR:
   se activa, borra todos los cachés viejos de Benchone y se
   desregistra solo. Así, cualquier teléfono que todavía tenga un
   service worker viejo queda arreglado apenas abre la app.
   ══════════════════════════════════════════════════════════════ */

self.addEventListener('install', function(event){
  self.skipWaiting(); // no esperar: activar de inmediato
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      // Borramos todos los cachés (los de Benchone y cualquier otro que hubiéramos dejado).
      return Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }).then(function(){
      return self.clients.claim();
    }).then(function(){
      // Nos desregistramos: a partir de acá, el navegador maneja todo directo
      // a la red, como si nunca hubiera habido service worker.
      return self.registration.unregister();
    }).then(function(){
      // Recargamos las pestañas abiertas para que tomen la app sin SW.
      return self.clients.matchAll({ type: 'window' }).then(function(clients){
        clients.forEach(function(client){ try{ client.navigate(client.url); }catch(e){} });
      });
    }).catch(function(){})
  );
});

// No interceptamos NINGUNA petición: todo pasa directo a la red.
// (Sin handler de 'fetch', el navegador se encarga normalmente.)

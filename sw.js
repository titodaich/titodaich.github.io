/* BenchOne — service worker
   ---------------------------------------------------------------------------
   Qué hace:
   - La app (index.html) se abre AL INSTANTE desde la copia guardada en el teléfono
     y, al mismo tiempo, se baja la última versión publicada. Si cambió, se guarda
     y se le avisa a la app para que se actualice sola.
   - Antes esperaba la red solo 4 segundos y, si no llegaba (el archivo pesa casi
     3 MB), mostraba la copia vieja SIN actualizarla: había teléfonos que quedaban
     días con una versión anterior.
   - NO hace falta tocar este archivo en cada subida. Solo se cambia si se modifica
     esta lógica.
   - Nunca toca los pedidos a la base de datos (Supabase): van siempre directo.
   --------------------------------------------------------------------------- */
const CACHE = 'bo-app-1';
const INDEX = new URL('index.html', self.registration.scope).href;
const RAIZ = new URL('./', self.registration.scope).href;
const LOGO = new URL('logo.png', self.registration.scope).href;
const CDN = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];
let hayNueva = false;   // se bajó una versión más nueva que la que tiene abierta algún teléfono

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Bajamos la app fresca (sin usar la copia del navegador) y la guardamos.
    try{
      const r = await fetch(new Request(INDEX, { cache: 'reload' }));
      if(r && r.ok){ await cache.put(INDEX, r.clone()); await cache.put(RAIZ, r); }
    }catch(e){ /* sin conexión: se guardará en la próxima apertura */ }
    try{
      const l = await fetch(new Request(LOGO, { cache: 'reload' }));
      if(l && l.ok) await cache.put(LOGO, l);
    }catch(e){}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Borramos las copias de versiones anteriores de este service worker.
    await Promise.all(keys.filter(k => k !== CACHE && (k.indexOf('benchone') !== -1 || k.indexOf('bo-app-') === 0)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if(d === 'skipWaiting'){ self.skipWaiting(); return; }
  // La app pregunta, al abrirse, si ya hay una versión más nueva guardada.
  if(d && d.tipo === 'benchone-hay-nueva' && hayNueva && event.source){
    try{ event.source.postMessage({ tipo: 'benchone-nueva-version' }); }catch(e){}
  }
});

async function avisarNuevaVersion(){
  hayNueva = true;
  try{
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cs.forEach(c => { try{ c.postMessage({ tipo: 'benchone-nueva-version' }); }catch(e){} });
  }catch(e){}
}

// ¿La respuesta nueva es distinta de la guardada?
async function esDistinta(guardada, nueva){
  try{
    const a = guardada.headers.get('etag'), b = nueva.headers.get('etag');
    if(a && b) return a !== b;
    const la = guardada.headers.get('last-modified'), lb = nueva.headers.get('last-modified');
    const ca = guardada.headers.get('content-length'), cb = nueva.headers.get('content-length');
    if(la && lb && ca && cb) return la !== lb || ca !== cb;
    const [ta, tb] = await Promise.all([guardada.text(), nueva.text()]);
    return ta !== tb;
  }catch(e){ return true; }
}

// La app: copia guardada al instante + actualización en segundo plano.
async function servirApp(event){
  const cache = await caches.open(CACHE);
  const guardada = (await cache.match(INDEX)) || (await cache.match(RAIZ));
  const paraComparar = guardada ? guardada.clone() : null;
  const deRed = (async () => {
    try{
      const resp = await fetch(new Request(INDEX, { cache: 'no-store' }));
      if(!resp || !resp.ok) return null;
      const cambio = paraComparar ? await esDistinta(paraComparar, resp.clone()) : true;
      if(cambio){
        await cache.put(INDEX, resp.clone());
        await cache.put(RAIZ, resp.clone());
        if(paraComparar) await avisarNuevaVersion();
      }
      return resp;
    }catch(e){ return null; }
  })();
  if(guardada){
    hayNueva = false;                 // esta apertura ya usa lo último que había guardado
    event.waitUntil(deRed);
    return guardada;
  }
  const r = await deRed;
  return r || new Response('<meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">Sin conexión. Abrí BenchOne con internet la primera vez.</body>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Librerías externas: se guardan una vez y se usan desde el teléfono.
async function primeroGuardado(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if(hit) return hit;
  const r = await fetch(req);
  if(r && (r.ok || r.type === 'opaque')){ try{ await cache.put(req, r.clone()); }catch(e){} }
  return r;
}

// Otros archivos propios (logo, etc.): red primero; si no hay red, la copia guardada.
async function primeroRed(req){
  const cache = await caches.open(CACHE);
  try{
    const r = await fetch(req);
    if(r && r.ok){ try{ await cache.put(req, r.clone()); }catch(e){} }
    return r;
  }catch(e){
    const hit = await cache.match(req);
    if(hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;                       // las escrituras nunca pasan por acá
  let url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if(CDN.indexOf(url.hostname) !== -1){ event.respondWith(primeroGuardado(req)); return; }
  if(url.origin !== self.location.origin) return;        // base de datos y demás: directo a la red
  if(/\/sw\.js$/.test(url.pathname)) return;             // el propio service worker: siempre de la red
  if(req.mode === 'navigate' || url.href.split('?')[0].split('#')[0] === INDEX){ event.respondWith(servirApp(event)); return; }
  event.respondWith(primeroRed(req));
});

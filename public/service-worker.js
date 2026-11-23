// Cache used to hand files received via Web Share Target over to the page.
const SHARE_CACHE = 'media-share-v1';
const SHARE_PREFIX = '/__share__/';
const MANIFEST_KEY = SHARE_PREFIX + 'manifest';

// Take control immediately – otherwise the very first share after install
// (or after an update) is not intercepted and the POST ends up on the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function handleShareTarget(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    console.error('Share target: cannot parse form data', error);
    return Response.redirect('/?share-target=error', 303);
  }

  const cache = await caches.open(SHARE_CACHE);

  // Remove leftovers of a previous, unfinished share
  for (const key of await cache.keys()) {
    await cache.delete(key);
  }

  // Diagnostics: what the sharing app / OS actually delivered
  const diag = {
    contentType: request.headers.get('Content-Type') || '',
    contentLength: request.headers.get('Content-Length') || '',
    entries: [],
  };
  const allFiles = [];
  for (const [field, value] of formData.entries()) {
    if (value instanceof File) {
      diag.entries.push({ field, kind: 'file', name: value.name, type: value.type, size: value.size });
      // Accept files from any field, not only "media". An empty part without
      // a name is just an empty form field, not a shared file.
      if (value.size > 0 || value.name) allFiles.push(value);
    } else {
      diag.entries.push({ field, kind: 'text', length: String(value).length });
    }
  }

  const files = [];
  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    // Use an index as the cache key – file names may contain characters
    // like "#", "?" or "," and several shared files can have the same name.
    const key = SHARE_PREFIX + i;
    // Pass the File directly – no extra in-memory copy via arrayBuffer()
    await cache.put(
      key,
      new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Length': String(file.size),
        },
      })
    );
    files.push({
      key,
      name: file.name || 'file-' + (i + 1),
      type: file.type || '',
      lastModified: file.lastModified || Date.now(),
    });
  }

  const manifest = {
    files,
    title: String(formData.get('name') || ''),
    text: String(formData.get('description') || ''),
    url: String(formData.get('link') || ''),
    createdAt: Date.now(),
    diag,
  };
  await cache.put(
    MANIFEST_KEY,
    new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })
  );

  return Response.redirect('/?share-target=1', 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/receive-files/') {
    event.respondWith(handleShareTarget(event.request));
  }
});

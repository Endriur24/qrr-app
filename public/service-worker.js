self.addEventListener('fetch', (fetchEvent) => {
  if (fetchEvent.request.url.endsWith('/receive-files/') && fetchEvent.request.method === 'POST') {
    return fetchEvent.respondWith(
      (async () => {
        const formData = await fetchEvent.request.formData();
        const files = formData.getAll('media');
        // const image = formData.get('image');
        const name = formData.get('name') || "";
        const description = formData.get('description') || "";
        const link = formData.get("link") || "";
        const keys = await caches.keys();
        const mediaCache = await caches.open(keys.filter((key) => key.startsWith('media'))[0]);
        let filenameList = [];
        for (const file of files) {
          if (file instanceof File) {
            const blob = await file.arrayBuffer();
            filenameList.push(file.name);
            await mediaCache.put(file.name, new Response(blob, { headers: { 'Content-Type': file.type } }));
          }
        }
        const filenameListString = files.map(file => file.name).join(',');

        return Response.redirect('./?share-target=1&files='+ encodeURIComponent(filenameListString) +'&name=' + encodeURIComponent(name) + '&description=' + encodeURIComponent(description) + '&link=' + encodeURIComponent(link), 303);
      })(),
    );
  }
});
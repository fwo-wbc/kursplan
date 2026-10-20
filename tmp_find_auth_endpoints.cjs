// Durchsucht die Postman-Collection nach allen Auth-Requests (URL + Methode + Body).
const fs = require('fs');

const col = JSON.parse(fs.readFileSync('tmp_edoobox_collection.json', 'utf8'));

function walk(items, path) {
  for (const item of items) {
    const p = path + ' / ' + (item.name || '?');
    if (item.request) {
      const url = typeof item.request.url === 'string' ? item.request.url : item.request.url?.raw;
      if (url && /auth/i.test(url)) {
        console.log('=== ' + p + ' ===');
        console.log('METHOD:', item.request.method);
        console.log('URL:', url);
        if (item.request.body?.raw) console.log('BODY:', item.request.body.raw.slice(0, 400));
        if (item.request.header) {
          for (const h of item.request.header) {
            if (h.key && /grant|auth|content/i.test(h.key)) {
              console.log('HEADER:', h.key, '=', h.value);
            }
          }
        }
        console.log('');
      }
    }
    if (item.item) walk(item.item, p);
  }
}

walk(col.item, 'ROOT');
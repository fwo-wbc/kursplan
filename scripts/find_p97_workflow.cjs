// Sucht den Workflow 'P97_Test_Duplicate_Offer' über die n8n Public API (paginiert).
const API_URL = 'https://m.webinarcenter.de/api/v1/workflows';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiOTdkMGQxZi1lNjVhLTRiMTQtYTZhNC05MGVhOTIxOGI3MzEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZGI0OTcxMmMtNTNiZC00YjE0LTg3ZDktMzg4NDY1MTJiNTYxIiwiaWF0IjoxNzg4NjkyODE5LCJleHAiOjE3OTM4NTQ4MDB9.mkdTL_VNQd077MA97-YPNaDnlqWTIqNBp45dgXF272k';

async function main() {
  let cursor = null;
  let seite = 0;
  while (true) {
    seite += 1;
    const url = cursor
      ? `${API_URL}?limit=100&cursor=${encodeURIComponent(cursor)}`
      : `${API_URL}?limit=100`;
    const res = await fetch(url, { headers: { 'X-N8N-API-KEY': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status} auf Seite ${seite}`);
    const body = await res.json();
    const treffer = body.data.filter((w) => /P97|Duplicate/i.test(w.name));
    for (const w of treffer) {
      console.log(JSON.stringify({ id: w.id, name: w.name, active: w.active, updatedAt: w.updatedAt }));
    }
    if (treffer.length > 0) {
      console.log(`GEFUNDEN auf Seite ${seite}`);
      return;
    }
    if (!body.nextCursor) {
      console.log(`Kein Treffer. Seiten durchsucht: ${seite}`);
      return;
    }
    cursor = body.nextCursor;
  }
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
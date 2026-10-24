// Verifikation der neuen Kursthemen-Seite + API per HTTP
async function main() {
  const base = 'http://localhost:3000';

  // 1) API /api/kursthemen
  const resApi = await fetch(`${base}/api/kursthemen`);
  console.log('GET /api/kursthemen -> Status', resApi.status);
  const data = await resApi.json();
  console.log('Anzahl Kurstitel:', data.length);
  console.log('Erste 5:', data.slice(0, 5).map((t) => t.titel).join(' | '));
  console.log('Letzte 3:', data.slice(-3).map((t) => t.titel).join(' | '));

  // 2) Seite /kursthemen
  const resPage = await fetch(`${base}/kursthemen`);
  console.log('GET /kursthemen -> Status', resPage.status);
  const html = await resPage.text();
  console.log('Seite enthaelt "Kursthemenmanagement":', html.includes('Kursthemenmanagement'));
}

main().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});
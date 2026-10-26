import { Pool, PoolClient } from 'pg';

/**
 * Erzeugt den Verbindungs-Pool:
 * - Bevorzugt DATABASE_URL (Connection-String, z. B. im Docker-/Serverbetrieb).
 * - Fallback: Einzelwerte DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.
 *
 * Bewusst KEIN hartkodiertes Standard-Passwort: Ohne gesetzte Zugangsdaten
 * schlägt die erste Verbindung fehl (Fail-fast statt Silent-Fallback), damit
 * kein ungewollter Zugriff mit einem bekannten Default möglich ist.
 */
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (connectionString) {
    return new Pool({ connectionString });
  }

  return new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'kursplan',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

const pool = createPool();

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Führt mehrere SQL-Statements innerhalb einer einzigen Transaktion aus.
 * Bei einem Fehler wird automatisch ein ROLLBACK ausgeführt, andernfalls COMMIT.
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback-Fehler bewusst verschlucken, der ursprüngliche Fehler zählt.
    }
    throw err;
  } finally {
    client.release();
  }
}
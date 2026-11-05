// =============================================================================
// Mail-Helper (Microsoft Graph API) für das Trainerportal
// -----------------------------------------------------------------------------
// Authentifizierung über den OAuth2 Client Credentials Flow (Azure AD) und
// Versand über die Microsoft Graph API (sendMail). Kein nodemailer/SDK nötig –
// es wird ausschließlich nativer Node-fetch verwendet.
//
// Umgebungsvariablen:
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//   AZURE_SENDER_MAIL (Standard: frank.woltmann@webinarcenter.de) – technisches
//     Postfach, über das der Versand über die Graph-API läuft
//   AZURE_FROM_MAIL (Standard: admin@webinarcenter.de) – sichtbare Absenderadresse
//
// Fehlen die Zugangsdaten, wird der Versand übersprungen und false
// zurückgegeben (kein Crash im Reset-Flow).
// =============================================================================

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID?.trim();
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID?.trim();
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const SENDER_EMAIL = process.env.AZURE_SENDER_MAIL?.trim() || 'frank.woltmann@webinarcenter.de';
const FROM_EMAIL = process.env.AZURE_FROM_MAIL?.trim() || 'admin@webinarcenter.de';
const FROM_NAME = 'webinarcenter Administrator';

const isConfigured = Boolean(AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET);

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Holt ein OAuth2-Zugriffstoken über den Client Credentials Flow.
 * Gibt das access_token zurück oder null bei Fehlern / fehlender Konfiguration.
 */
async function getAccessToken(): Promise<string | null> {
  if (!isConfigured) return null;

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(AZURE_TENANT_ID!)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: AZURE_CLIENT_ID!,
    client_secret: AZURE_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[mailer] Token-Abruf fehlgeschlagen (HTTP ${res.status}):`, errText);
      return null;
    }

    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      console.error('[mailer] Token-Antwort enthält kein access_token.');
      return null;
    }
    return data.access_token;
  } catch (err) {
    console.error('[mailer] Token-Abruf (Graph) fehlgeschlagen:', err);
    return null;
  }
}

/**
 * Versendet eine E-Mail über die Microsoft Graph API. Gibt true bei Erfolg
 * (HTTP 202) zurück, false wenn keine Azure-Konfiguration vorhanden ist oder
 * der Versand fehlschlägt.
 */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  if (!isConfigured) {
    console.warn(
      '[mailer] Keine Azure/Graph-Konfiguration (AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET) – Versand übersprungen.',
    );
    return false;
  }

  const accessToken = await getAccessToken();
  if (!accessToken) return false;

  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_EMAIL)}/sendMail`;
  const htmlContent = input.html ?? input.text;

  const payload = {
    message: {
      subject: input.subject,
      body: {
        contentType: 'HTML',
        content: htmlContent,
      },
      from: {
        emailAddress: {
          address: FROM_EMAIL,
          name: FROM_NAME,
        },
      },
      toRecipients: [
        {
          emailAddress: {
            address: input.to,
          },
        },
      ],
    },
    saveToSentItems: false,
  };

  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // HTTP 202 = Accepted -> erfolgreich versendet
    if (res.status === 202) {
      return true;
    }

    const errText = await res.text();
    let graphError = errText;
    try {
      const parsed = JSON.parse(errText) as { error?: { code?: string; message?: string } };
      if (parsed.error) {
        graphError = `${parsed.error.code ?? 'unknown'}: ${parsed.error.message ?? errText}`;
      }
    } catch {
      // kein JSON -> roher Text verwenden
    }
    console.error(`[mailer] Graph sendMail fehlgeschlagen (HTTP ${res.status}):`, graphError);
    return false;
  } catch (err) {
    console.error('[mailer] E-Mail-Versand (Graph) fehlgeschlagen:', err);
    return false;
  }
}
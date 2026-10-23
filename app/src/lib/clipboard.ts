/**
 * Kopiert den übergebenen Text in die Zwischenablage.
 *
 * Bevorzugt wird die moderne Clipboard-API (navigator.clipboard.writeText),
 * die in sicheren Kontexten (HTTPS bzw. localhost) verfügbar ist. Als Fallback
 * für ältere Browser dient die klassische execCommand-Methode über ein
 * unsichtbares Textarea.
 *
 * @returns true bei Erfolg, false bei Fehlschlag (z. B. fehlende Berechtigung).
 */
export async function kopiereInZwischenablage(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback auf die klassische Methode unten.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
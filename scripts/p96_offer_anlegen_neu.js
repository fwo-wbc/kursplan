// Angebot durch DUPLIZIEREN der Vorlage erzeugen und veroeffentlichen.
//  1) POST /v2/offer/{template_id}/duplicate  (Form-Data: name, category, type=offer, status=1, tags=)
//  2) GET  /v2/offer/{newOfferId}             (Verifikation status === 1)
// WICHTIG: Ein nachgelagerter PUT /v2/offer/{id} mit status liefert bei edoobox
// HTTP 200 + {error: ED90100, success: false} - der Status laesst sich NUR beim
// Anlegen setzen (status=1 => veroeffentlicht, 0 => Entwurf). Deshalb status=1
// direkt im Duplicate-Body. Die Quell-Vorlage (sourceOfferId) bleibt dabei
// unveraendert im Status "Entwurf" erhalten.
// TAGS: edoobox uebernimmt beim Duplizieren die Tags der Vorlage (z. B.
// "NextWordOnlineEvent"). Diese duerfen auf dem neuen Angebot NICHT stehen.
//   a) Der Duplicate-Body sendet deshalb zusaetzlich tags= (leer). Ob edoobox
//      das Feld dort akzeptiert, ist nicht dokumentiert - unbekannte Parameter
//      werden laut Diagnosebericht stillschweigend ignoriert.
//   b) Garantie: Nach dem Duplicate wird das neue Angebot per GET gelesen und
//      falls tags nicht leer sind, per PUT /v2/offer/{newOfferId} mit
//      { data: { tags: [] } } gezielt geleert. Der PUT ist defensiv: Lehnt
//      edoobox das Feld ab (ED80100), bricht der Kurstransfer NICHT ab,
//      sondern vermerkt es im State (tags_bereinigt=false + Hinweis).
// Jeder edoobox-Fehler wird mit dem EXAKTEN Antwort-Body als Error geworfen:
//   edoobox Fehler [<status>] ...: <JSON-Body>
const state = $input.first().json;
const basis = state.basis || 'https://app1.edoobox.com';

// 1. Feldnamen robust aufloesen
const sourceOfferId = state.sourceOfferId || state.template_offer_id || state.template_id;
const categoryId = String(state.category_id || state.category || '').trim();
const offerTitle = state.newTitle || state.kurstitel || state.vorlagen_name || state.thema || 'Neues Angebot';

if (!sourceOfferId) {
  throw new Error('Keine Quell-Angebots-ID (sourceOfferId / template_id) im State vorhanden.');
}
if (!categoryId) {
  throw new Error('Keine Kategorie-ID (category_id / category) im State vorhanden.');
}

const baseHeaders = {
  'Authorization': `Bearer ${state.token}`,
  'grant-type': 'access_token',
  ...(state.edid ? { edid: state.edid } : {})
};

function parseBody(body) {
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (e) { return body; }
  }
  return body;
}

// GET /v2/offer/{id} liefert { data: { <id>: { record } } } bzw. { data: [] }.
function entpacken(body) {
  if (!body || typeof body !== 'object') return body;
  let d = body.data ?? body;
  while (d && typeof d === 'object' && !Array.isArray(d)) {
    const keys = Object.keys(d);
    if (keys.length === 1 && d[keys[0]] && typeof d[keys[0]] === 'object') {
      d = d[keys[0]];
      continue;
    }
    break;
  }
  if (Array.isArray(d)) return d[0] ?? null;
  return d;
}

// Einheitlicher edoobox-Aufruf: HTTP-Status und Antwort-Body werden immer
// ausgewertet; bei Fehlern wird der exakte Body im Error-Text ausgegeben.
const edoobox = async (schritt, optionen) => {
  let antwort;
  try {
    antwort = await this.helpers.httpRequest({
      ...optionen,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
      timeout: 60000
    });
  } catch (error) {
    const status = error.response?.status ?? error.cause?.response?.status ?? error.statusCode ?? error.httpCode;
    const data = error.response?.data ?? error.cause?.response?.data ?? error.message;
    throw new Error(`edoobox Fehler [${status}] bei ${schritt}: ${JSON.stringify(data)}`);
  }
  const body = parseBody(antwort.body);
  const ok = antwort.statusCode >= 200 && antwort.statusCode < 300 && !(body && typeof body === 'object' && body.success === false);
  if (!ok) {
    throw new Error(`edoobox Fehler [${antwort.statusCode}] bei ${schritt}: ${JSON.stringify(body)}`);
  }
  return body;
};

try {
  // 2. Duplizieren via application/x-www-form-urlencoded.
  //    tags= (leer) wird mitgesendet, damit edoobox die Vorlagen-Tags
  //    (z. B. "NextWordOnlineEvent") nicht auf das neue Angebot uebernimmt.
  const bodyData = 'name=' + encodeURIComponent(offerTitle) +
                   '&category=' + encodeURIComponent(categoryId) +
                   '&type=offer' +
                   '&status=1' +
                   '&tags=';

  const dupBody = await edoobox(`POST /v2/offer/${sourceOfferId}/duplicate (category=${categoryId})`, {
    method: 'POST',
    url: `${basis}/v2/offer/${sourceOfferId}/duplicate`,
    headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyData
  });

  const dupData = dupBody && (dupBody.data ?? dupBody.offer ?? dupBody);
  let newOfferId;
  if (typeof dupData === 'string' || typeof dupData === 'number') {
    newOfferId = dupData;
  } else {
    const rec = (dupData && (dupData.id ?? dupData.offer_id)) ? dupData : entpacken(dupBody);
    newOfferId = rec && (rec.id ?? rec.offer_id);
  }
  if (!newOfferId) {
    throw new Error('edoobox Fehler [2xx]: Duplizieren ohne neue Offer-ID, Antwort: ' + JSON.stringify(dupBody));
  }

  // 4. Zuruecklesen und Veroeffentlichung verifizieren (status === 1)
  const getBody = await edoobox(`GET /v2/offer/${newOfferId}`, {
    method: 'GET',
    url: `${basis}/v2/offer/${newOfferId}`,
    headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    json: true
  });
  const offerRoh = entpacken(getBody);
  if (!offerRoh || Number(offerRoh.status) !== 1) {
    throw new Error('edoobox Fehler [verify]: Angebot ' + newOfferId + ' ist nicht veroeffentlicht (status !== 1), Antwort: ' + JSON.stringify(getBody));
  }

  // 4b. Tags-Bereinigung: Falls edoobox die Vorlagen-Tags trotz tags= im
  //     Duplicate-Body uebernommen hat, werden sie hier gezielt geleert.
  //     tags ist ein Array von Objekten [{"tag": "<tag_id>", "type": "normal"}].
  //     Der PUT ist defensiv: Ein ED80100 (Feld per PUT nicht setzbar) bricht
  //     den Kurstransfer nicht ab, sondern wird im State dokumentiert.
  let tagsBereinigt = false;
  let tagsHinweis = null;
  const tagsRoh = offerRoh.tags;
  const hatTags = Array.isArray(tagsRoh) ? tagsRoh.length > 0 : Boolean(tagsRoh);
  if (hatTags) {
    try {
      await edoobox(`PUT /v2/offer/${newOfferId} (tags leeren)`, {
        method: 'PUT',
        url: `${basis}/v2/offer/${newOfferId}`,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        body: { data: { tags: [] } },
        json: true
      });
      tagsBereinigt = true;
    } catch (tagFehler) {
      tagsHinweis = tagFehler.message;
    }
  }

  // 5. State fuer Folgeknoten (P96 Date anlegen) anreichern
  return [{
    json: {
      ...state,
      offer_id: String(newOfferId),
      published: true,
      offer: offerRoh,
      tags_bereinigt: tagsBereinigt,
      ...(tagsHinweis ? { tags_bereinigung_hinweis: tagsHinweis } : {})
    }
  }];
} catch (error) {
  if (typeof error.message === 'string' && error.message.startsWith('edoobox Fehler')) {
    throw error;
  }
  throw new Error(`edoobox Fehler [${error.response?.status}]: ${JSON.stringify(error.response?.data ?? error.message)}`);
}
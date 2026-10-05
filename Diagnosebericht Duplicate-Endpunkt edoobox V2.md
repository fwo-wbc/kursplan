# Diagnosebericht: `POST /v2/offer/{template_id}/duplicate` (edoobox V2)

**Datum:** 2026-09-29 · **Umgebung:** `https://app1.edoobox.com` (Produktion) · **Vorlage:** `offer_4c711bb47cc4_10438619540` (Excel Grundlagen Modul 1)

Alle Tests liefen über temporäre Diagnoseskripte (`app/.tmp_zoo_dup_diag*.cjs`) mit einem frischen API-Token. Jedes Test-Duplikat wurde nach der Prüfung wieder per `DELETE /v2/offer/{id}` entfernt.

---

## 1) Welche Parameter akzeptiert der Endpunkt?

| Parameter | Pflicht? | Verhalten |
|---|---|---|
| `name` | **ja** | Neuer Angebotstitel. |
| `category` | **ja** | Ziel-Kategorie (Unterkategorie `[kdnr] [Firmenname]`). |
| `type` | **nein** (laut Fehlermeldung), **praktisch erforderlich** | Ohne `type` bricht edoobox mit **HTTP 402 ED80100** ab. Mit `type=offer` wird das Duplikat erzeugt. |
| `copy_prices` | nein | Wird **ignoriert** – Preise werden nicht kopiert. |
| `copy_dates` | nein | Wird **ignoriert** – Termine werden nicht kopiert. |
| `copy_all` | nein | Wird **ignoriert**. |
| `include_prices` | nein | Wird **ignoriert**. |

Die Fehlermeldung von edoobox bestätigt die Pflichtfelder exakt:

```json
{"error":"ED80100","type":"api","require":{"name":true,"category":true,"type":false},"success":false}
```

**Was bewirkt `type`?** Es gibt den Typ des zu erzeugenden Objekts an (hier `offer`). Ohne diesen Parameter verweigert edoobox die Ausführung komplett – der Endpunkt ist ohne `type` nicht aufrufbar, obwohl er in `require` als `false` (optional) geführt wird. Die Parameter `copy_prices`/`copy_dates`/`copy_all`/`include_prices` existieren am Endpunkt **nicht**; sie werden stillschweigend ignoriert (Test G mit allen Parametern + `type` erzeugte ein Duplikat, das trotzdem keine Preise/Texte enthielt).

> Hinweis: Die Postman-Collection kennt zusätzlich den Endpunkt `POST /v2/offer/:offer_id/copy` mit `copy_dates`, `names[]`, `number`, `category` – dieser ist aber ein anderer (Copy-)Endpunkt und wurde hier nicht weiterverfolgt.

---

## 2) Was erbt das Duplikat tatsächlich? (Test B, `type=offer`)

**Vorlage** (`GET /v2/offer/{template_id}`):
- Top-Level-Felder u. a.: `id, name, number, user_maximum, user_minimal, date_start, date_end, image, category, offerdef, type, mode, status, shortdescription, tags, internal_code`
- `shortdescription`: leer (`""`)
- Texte (`GET /v2/text/list?filter=resource_id=…`): `offer` (Name), `url`, `additionaltext1`, `additionaltext2`, `additionaltext3` (alle `de`) – **keine** `description`
- Preiskategorien (`GET /v2/pricecategory/list`): 3 Stück
  - `Preis für max. 4 Personen` · 499 · default=true · status=true
  - `Preis für jede weitere Person` · 49 · default=false · status=false
  - `Inklusive` · 0 · default=false · status=false

**Duplikat** (`GET /v2/offer/{newOfferId}`):
- Geerbt: `name` (neuer Name), `url`, `image`, `offerdef`, `mode`, `user_minimal/maximum`, `status` etc. (Strukturfelder)
- **Nicht geerbt:** alle Texte (`additionaltext1–3`, `description`) und **alle Preiskategorien**
- Preise: edoobox erzeugt automatisch genau **eine** leere Standardkategorie `---` (amount 0, default=true, status=true)

**Fazit:** Der Duplicate-Endpunkt kopiert die Unterobjekte (Preise, Texte) per API **prinzipiell nicht**. Die Beobachtung des Nutzers (fehlende Texte, sofort wieder erzeugte `---`-Kategorie) ist damit reproduziert und bestätigt.

---

## 3) Verifizierter Reparatur-Workflow

Alle Schritte wurden an echten Duplikaten getestet und per GET verifiziert:

| Schritt | Endpunkt | Ergebnis |
|---|---|---|
| 1. Duplikat anlegen | `POST /v2/offer/{template}/duplicate` mit `name`, `category`, **`type=offer`** | HTTP 200, neue `offer_id` |
| 2. `---`-Kategorie befüllen | `PUT /v2/pricecategory/{id}` mit `{amount, status, order}` | HTTP 200 – `amount` wird gesetzt, **Name bleibt `---`** |
| 3. Namen der Kategorie setzen | `POST /v2/text` mit `{language:"de", resource:"pricecategory", resource_id:<pricecategory_id>, value:"Preis für max. 4 Personen"}` | HTTP 200 – Name erscheint korrekt |
| 4. Weitere Preise anlegen | `POST /v2/pricecategory` mit `{amount, name, status, order, offer, default}` | HTTP 200 – Preise mit Namen angelegt |
| 5. Texte übernehmen | `POST /v2/text` mit `{language, resource, resource_id, value}` je Vorlagentext (`additionaltext1–3`, ggf. `description`) | HTTP 200 – Texte übernommen |

**Verifiziertes Endergebnis des reparierten Duplikats:**

```
Preiskategorien:
- Preis für max. 4 Personen        · 499 · default=true  · status=true   (ehemalige "---"-Kategorie)
- Preis für jede weitere Person    ·  49 · default=false · status=false
- Inklusive                        ·   0 · default=false · status=false

Texte:
- additionaltext1 / additionaltext2 / additionaltext3 (de) – identisch zur Vorlage
```

### Wichtige Randbefunde

- **`DELETE /v2/pricecategory/{id}` auf die `---`-Kategorie → HTTP 404 ED80019.** Die automatisch erzeugte Standardkategorie ist **unentfernbar**. Sie muss daher befüllt (Schritt 2+3) statt gelöscht werden.
- **`PUT /v2/offer/{id}` mit `shortdescription` → HTTP 402 ED80100.** Angebots-Texte lassen sich nicht über den Offer-PUT setzen; der einzige Weg sind die Text-Ressourcen (`POST /v2/text`).
- `POST /v2/pricecategory` ignoriert `default` – die erste (befüllte `---`-)Kategorie bleibt die Default-Kategorie. Das ist gewollt, da sie den ersten Vorlagenpreis trägt.

---

## 4) Empfehlung für den P96-Workflow

Der Knoten „P96 Offer anlegen“ muss nach dem Duplicate-Call (mit `type=offer`!) die fehlenden Unterobjekte nachziehen:

1. **Duplicate:** `POST /v2/offer/{template_id}/duplicate` mit `name`, `category`, `type=offer` (Form-Data).
2. **Preise:**
   - `GET /v2/pricecategory/list?filter=offer=<neu>` → die eine `---`-Kategorie holen.
   - `PUT /v2/pricecategory/{id}` mit `{amount, status, order}` des **ersten** Vorlagenpreises.
   - `POST /v2/text` (`resource=pricecategory`) für den Namen des ersten Preises.
   - Für jeden weiteren Vorlagenpreis: `POST /v2/pricecategory` mit `{amount, name, status, order, offer}`.
3. **Texte:** `GET /v2/text/list?filter=resource_id=<template>` → für jeden Text außer `offer`/`url`: `POST /v2/text` mit `{language, resource, resource_id=<neu>, value}`.
4. **Veröffentlichung:** wie bisher `PUT /v2/offer/{id}` mit `{data:{status:1}}` (funktioniert, da nur `status` gesetzt wird).

Damit sind Beschreibungen/Zusatztexte und Preiskategorien vollständig im Duplikat vorhanden, und edoobox erzeugt keine sichtbare leere `---`-Kategorie mehr (sie trägt dann den ersten Vorlagenpreis).
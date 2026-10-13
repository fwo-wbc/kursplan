#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_edoobox_copy.py
====================
Isolierter Test des edoobox Copy-Endpunkts:

    POST https://app1.edoobox.com/v2/offer/{offer_id}/copy

Hintergrund: Der n8n-Knoten "Offer duplizieren (/copy)" meldet bei diesem
Endpunkt HTTP 402 (ED80100). Das Abonnement ist in Ordnung – vermutlich
liegt der Fehler an den Parametern im JSON-Body. Dieses Skript testet drei
Body-Varianten isoliert und zeigt Statuscode + JSON-Antwort je Variante.

Vorbereitung (Credentials):
    Die edoobox App-Key/App-Secret liegen verschlüsselt in der n8n-
    Credential-Datenbank und sind nicht auslesbar. Das Skript liest sie
    deshalb aus einer .env-Datei im selben Ordner (oder aus
    Umgebungsvariablen):

        EDOOBOX_APP_KEY=...
        EDOOBOX_APP_SECRET=...

    Optional kann die edid gesetzt werden (Fallback aus P97-Workflow):
        EDOOBOX_EDID=6aca4a66d65d69000654423106b9d78ddd5c3355926e80bdf7de22dc1

Ablauf:
    1. Frisches Access-Token über POST /v2/auth holen
       (grant-type: password, expire = jetzt + 24 h)
    2. Drei Body-Varianten gegen /copy senden
    3. Statuscode + JSON-Antwort je Variante ausgeben
    4. Erfolgreich erzeugte Kopien werden per DELETE /v2/offer/{id}
       wieder entfernt; falls das Löschen fehlschlägt, wird die neue
       Offer-ID ausgegeben, damit sie manuell zugeordnet werden kann.
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE_URL = "https://app1.edoobox.com"
OFFER_ID = "offer_8d72df08692f_10460260010"
COPY_URL = f"{BASE_URL}/v2/offer/{OFFER_ID}/copy"

# edid-Fallback aus dem P97-Workflow (Knoten "Duplicate Offer").
EDID_FALLBACK = "6aca4a66d65d69000654423106b9d78ddd5c3355926e80bdf7de22dc1"


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

def load_env():
    """Lädt eine .env-Datei im Skriptverzeichnis (einfaches KEY=VALUE-Parsing)."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.isfile(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def http_request(method, url, headers=None, body=None, timeout=30):
    """Führt einen HTTP-Request aus und liefert (status, response_dict|None)."""
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    for name, value in (headers or {}).items():
        req.add_header(name, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, {"_raw": raw}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            return err.code, json.loads(raw)
        except json.JSONDecodeError:
            return err.code, {"_raw": raw}


def get_token(app_key, app_secret):
    """
    Holt ein frisches Access-Token über POST /v2/auth.

    edoobox V2 akzeptiert die Credentials wahlweise als Basic-Auth-Header
    oder im JSON-Body. Es wird zuerst der Body-Weg (Standard laut V2-Doku)
    versucht; schlägt das fehl, folgt der Basic-Auth-Weg.
    """
    expire = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    headers = {
        "grant-type": "password",
        "Content-Type": "application/json",
    }

    # Versuch 1: app_key/app_secret im JSON-Body
    body = {"app_key": app_key, "app_secret": app_secret, "expire": expire}
    status, resp = http_request("POST", f"{BASE_URL}/v2/auth", headers, body)
    if status == 200 and resp:
        token = None
        if isinstance(resp.get("data"), str):
            token = resp["data"]
        elif isinstance(resp.get("access_token"), str):
            token = resp["access_token"]
        if token:
            return token, resp

    # Versuch 2: Basic-Auth-Header
    basic = base64.b64encode(f"{app_key}:{app_secret}".encode("utf-8")).decode("ascii")
    headers["Authorization"] = f"Basic {basic}"
    status, resp = http_request("POST", f"{BASE_URL}/v2/auth", headers, body)
    if status == 200 and resp:
        token = None
        if isinstance(resp.get("data"), str):
            token = resp["data"]
        elif isinstance(resp.get("access_token"), str):
            token = resp["access_token"]
        if token:
            return token, resp

    raise RuntimeError(
        f"Auth fehlgeschlagen (Status {status}). Antwort: {json.dumps(resp, ensure_ascii=False)}"
    )


def extract_offer_id(resp):
    """
    Extrahiert die neue Offer-ID aus einer Copy-Antwort.
    edoobox V2 liefert typischerweise { data: { <id>: { record } } } bzw.
    { data: [] } oder { data: { id: ... } }.
    """
    if not isinstance(resp, dict):
        return None
    d = resp.get("data", resp)
    if isinstance(d, str):
        return d
    if isinstance(d, list):
        return d[0].get("id") if d and isinstance(d[0], dict) else None
    if isinstance(d, dict):
        if d.get("id"):
            return str(d["id"])
        if d.get("offer_id"):
            return str(d["offer_id"])
        keys = list(d.keys())
        if len(keys) == 1:
            inner = d[keys[0]]
            if isinstance(inner, dict):
                rec = inner.get("record", inner)
                if isinstance(rec, dict):
                    return str(rec.get("id") or rec.get("offer_id") or keys[0])
                return str(keys[0])
    return None


def delete_offer(token, edid, offer_id):
    """Löscht eine Testkopie per DELETE /v2/offer/{id}."""
    headers = {
        "Authorization": f"Bearer {token}",
        "grant-type": "access_token",
        "edid": edid,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    status, resp = http_request("DELETE", f"{BASE_URL}/v2/offer/{offer_id}", headers)
    return status, resp


# ---------------------------------------------------------------------------
# Body-Varianten
# ---------------------------------------------------------------------------

def build_variants():
    """Baut die drei zu testenden Body-Varianten."""
    ts = int(time.time())

    # Variante 1a: minimaler Body
    v1a = {"data": {}}

    # Variante 1b: minimaler Body mit copy_dates=false
    v1b = {"data": {"copy_dates": False}}

    # Variante 2: ohne Datumsangaben, nur number und names
    # (Parameter laut Postman-Collection des /copy-Endpunkts)
    v2 = {
        "data": {
            "number": f"TEST-EDO-{ts}",
            "names": {"de": f"TEST-Kopie {ts}"},
        }
    }

    # Variante 3: voller Body – Kombination der /copy-Parameter
    # (copy_dates, names, number, category) mit den Feldern, die der
    # P97-Duplicate-Workflow für /v2/offer verwendet (offerdef, type,
    # mode, status). category/offerdef stammen aus der Vorlage.
    v3 = {
        "data": {
            "number": f"TEST-EDO-FULL-{ts}",
            "names": {"de": f"TEST-Kopie voll {ts}"},
            "copy_dates": False,
            "category": "category_41b0c0d06429_10460223670",
            "offerdef": "offerdef_f9540e6ac1fb_199835",
            "type": "offer",
            "mode": "Online",
            "status": 1,
        }
    }

    return [
        ("Variante 1a: minimaler Body {'data': {}}", v1a),
        ("Variante 1b: minimaler Body + copy_dates=false", v1b),
        ("Variante 2: ohne Datumsangaben (number + names)", v2),
        ("Variante 3: voller Body (copy + duplicate-Felder)", v3),
    ]


# ---------------------------------------------------------------------------
# Hauptablauf
# ---------------------------------------------------------------------------

def main():
    load_env()

    app_key = os.environ.get("EDOOBOX_APP_KEY", "").strip()
    app_secret = os.environ.get("EDOOBOX_APP_SECRET", "").strip()
    edid = os.environ.get("EDOOBOX_EDID", "").strip() or EDID_FALLBACK

    if not app_key or not app_secret:
        print("FEHLER: EDOOBOX_APP_KEY / EDOOBOX_APP_SECRET fehlen.")
        print("Bitte .env-Datei im Skriptordner anlegen:")
        print("  EDOOBOX_APP_KEY=...")
        print("  EDOOBOX_APP_SECRET=...")
        sys.exit(2)

    print("=" * 78)
    print("edoobox Copy-Endpunkt – isolierter Test")
    print(f"  Endpunkt : POST {COPY_URL}")
    print(f"  edid     : {edid}")
    print("=" * 78)

    # 1) Token holen
    print("\n[1/3] Token holen (POST /v2/auth) ...")
    token, auth_resp = get_token(app_key, app_secret)
    print(f"  OK – Token erhalten (Länge {len(token)}).")

    headers = {
        "Authorization": f"Bearer {token}",
        "grant-type": "access_token",
        "edid": edid,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    # 2) Varianten testen
    print("\n[2/3] Copy-Requests ...")
    erzeugte_ids = []
    for label, body in build_variants():
        print(f"\n--- {label} ---")
        print(f"  Body: {json.dumps(body, ensure_ascii=False)}")
        status, resp = http_request("POST", COPY_URL, headers, body)
        print(f"  Status: {status}")
        print(f"  Antwort: {json.dumps(resp, ensure_ascii=False, indent=2)}")
        if status == 200:
            new_id = extract_offer_id(resp)
            if new_id:
                erzeugte_ids.append(new_id)
                print(f"  -> Neue Offer-ID: {new_id}")
            else:
                print("  -> Antwort enthält keine erkennbare Offer-ID.")

    # 3) Cleanup
    print("\n[3/3] Cleanup erfolgreich erzeugter Testkopien ...")
    if not erzeugte_ids:
        print("  Keine Testkopien erzeugt – nichts zu löschen.")
    for offer_id in erzeugte_ids:
        status, resp = delete_offer(token, edid, offer_id)
        if status == 200:
            print(f"  OK  – Testkopie {offer_id} gelöscht.")
        else:
            print(
                f"  WARN – Löschen von {offer_id} fehlgeschlagen (Status {status}). "
                f"Antwort: {json.dumps(resp, ensure_ascii=False)}"
            )
            print(f"  Bitte manuell zuordnen/löschen: {offer_id}")

    print("\nFertig.")


if __name__ == "__main__":
    main()

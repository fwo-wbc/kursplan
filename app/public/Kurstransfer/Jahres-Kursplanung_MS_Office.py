# -*- coding: utf-8 -*-
"""
Jahres-Kursplanung MS Office
================================
Erzeugt die Excel-Datei "Jahres-Kursplanung_MS_Office_<JAHR>.xlsx" mit zwei Blättern:

1. Sheet "Terminplanung <JAHR>": Tages-Kalender mit Wochenplan (Mo–Fr) inkl.
   Feiertagen, Brückentagen und Urlaubsphasen. Die Kurs-Belegungen werden
   direkt als standardisierte Kurs-Codes geschrieben
   (Spalten: Kurs_Code, Kurs_Code_Prio2, Kurs_Code_Prio3).

2. Sheet "Kurs_Definitionen": Stammdatenblatt mit den 20 verifizierten
   Kurs-Definitionen (Kurs_Code, Kursname, Kategorie_ID, Kategorie_Name,
   Vorlage_Offer_ID).

Ausgabedatei: Jahres-Kursplanung_MS_Office_2027.xlsx
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import date, timedelta

# ---------------------------------------------------------------------------
# Feste Projektfakten
# ---------------------------------------------------------------------------
PLAN_YEAR = 2027
OUTPUT_FILE = "Jahres-Kursplanung_MS_Office.xlsx"

# 20 standardisierte Kurs-Definitionen (verifiziert aus der bestehenden Excel)
# Format: (Kurs_Code, Kursname, Kategorie_ID, Kategorie_Name, Vorlage_Offer_ID)
KURS_DEFINITIONEN = [
    ("xls-gl-m1", "Excel Grundlagen Modul 1: Basiswissen & KI",
     "category_cba26fc247a0_4287075190", "Excel GL M1",
     "offer_f7d26c266c1a_10079580340"),
    ("xls-gl-m2", "Excel Grundlagen Modul 2: Zeitsparende Techniken, Zahlenformate & KI",
     "category_b6c69b49d5cb_5661790135", "Excel GL M2",
     "offer_47bc0a80c77f_10079671190"),
    ("xls-ab-m1", "Excel Aufbau Modul 1: Logikfunktionen, XVERWEIS & KI",
     "category_d56c2197d695_8247708195", "Excel AB M1",
     "offer_9ba610263a0f_10079762040"),
    ("xls-pivot-komp", "Excel: Mit Pivot-Tabellen Daten auswerten (inkl. KI)",
     "category_9db1016f2ef2_4393660410", "Excel - Pivot-Tabellen (kompakt)",
     "offer_1cc9a9a95915_10154231785"),
    ("out-gl", "Outlook Grundlagen (kompakt)",
     "category_de5473f2a891_4394814205", "Outlook Grundlagen",
     "offer_17fea7f8061a_10088183835"),
    ("out-ab", "Outlook Aufbau (kompakt)",
     "category_19990b2ab29c_7368525490", "Outlook Aufbau",
     "offer_1033197d9dc5_10088238345"),
    ("ppt-gl-komp", "PowerPoint Grundlagen (kompakt)",
     "category_86933aca401a_4369230845", "PowerPoint Grundlagen (kompakt)",
     "offer_2f104b6e01be_10088301940"),
    ("ppt-ab-komp", "PowerPoint Aufbau (kompakt)",
     "category_35669a3eef94_7223801440", "PowerPoint Aufbau (kompakt)",
     "offer_d2ca859ace53_10088374620"),
    ("xls-ab-m2", "Excel Aufbau Modul 2: Bedingungen, Logik-Formeln, Diagramme & KI",
     "category_d4244a55bc4e_8811704995", "Excel AB M2",
     "offer_236366f5548c_10154140935"),
    ("xls-pq-gl", "Excel: Daten einlesen mit Power Query (Grundlagen)",
     "category_fea673d28fee_5661926410", "Excel - Power Query Grundlagen",
     "offer_1d9142ce8b2e_10155576365"),
    ("xls-umfang", "Excel: Große Tabellen im Griff",
     "category_2e3b48532c31_4393733090", "Excel - Große Tabellen",
     "offer_96630b1f47b8_10154186360"),
    ("xls-gl-m3", "Excel Grundlagen Modul 3: Professionelle Datenaufbereitung & KI",
     "category_0cb624b43f98_8811714080", "Excel GL M3",
     "offer_e6eae691d9a1_10154004660"),
    ("xls-gl-m4", "Excel Grundlagen Modul 4: Tabellenverknüpfungen, Zellenschutz & KI",
     "category_a14bf04a5f66_4989999810", "Excel GL M4",
     "offer_28e512e190b5_10154077340"),
    ("ppt-ds", "PowerPoint - Designvorlagen",
     "category_8297cc1dac67_4421387830", "PowerPoint - Designvorlagen erstellen",
     "offer_575947ff258e_10154295380"),
    ("ppt-vb", "PowerPoint - Präsentation vorbereiten",
     "category_bd10e8707d87_4422759665", "PPoint - Eine Präsentation richtig vorbereiten",
     "offer_bfc6b19338a3_10154322635"),
    ("wrd-ab-komp", "Word Aufbau (kompakt)",
     "category_ae4fabfd0acd_4287102445", "Word Aufbau (kompakt)",
     "offer_b5b0ef7b4410_10088501810"),
    ("wrd-dokvorl", "Word - Dokumentvorlagen erstellen",
     "category_15cf432edf8d_5109231350", "Word - Dokumentvorlagen erstellen",
     "offer_c3eb3432172f_10219916335"),
    ("wrd-gl-komp", "Word Grundlagen (kompakt)",
     "category_3a27e78a1da1_4287084275", "Word Grundlagen kompakt",
     "offer_bd4938f08741_10088456385"),
    ("wrd-serie", "Word - Seriendruck",
     "category_41b0c0d06429_10460223670", "Vorlagen für offene Kurse",
     "offer_8d72df08692f_10460260010"),
    ("wrd-umfang", "Word - Umfangreiche Dokumente",
     "category_a520baeacc58_4391407330", "Word - Umfangreiche Dokumente",
     "offer_879f1b4ccbfd_10154358975"),
]

# Zuordnung Klartext-Wochenstruktur -> Kurs-Code (für alle Prio-Spalten)
NAMED_CODES = {
    "Excel Grundlagen Modul 1": "xls-gl-m1",
    "PowerPoint Grundlagen": "ppt-gl-komp",
    "Word Grundlagen": "wrd-gl-komp",
    "Excel Grundlagen Modul 2": "xls-gl-m2",
    "PowerPoint Aufbau": "ppt-ab-komp",
    "Word Aufbau": "wrd-ab-komp",
    "Excel Grundlagen Modul 3": "xls-gl-m3",
    "Outlook Grundlagen": "out-gl",
    "Excel: Große Tabellen": "xls-umfang",
    "Excel Aufbau Modul 1": "xls-ab-m1",
    "Excel: Pivot-Tabellen": "xls-pivot-komp",
    "Outlook Aufbau": "out-ab",
    "Excel Aufbau Modul 2": "xls-ab-m2",
    "Excel Grundlagen Modul 4": "xls-gl-m4",
    "Word: Seriendruck": "wrd-serie",
    "PowerPoint: Präsentation vorbereiten": "ppt-vb",
    "Word: Dokumentvorlagen": "wrd-dokvorl",
    "Word: Umfangreiche Dokumente": "wrd-umfang",
    "Excel: Power Query Grundlagen": "xls-pq-gl",
    "PowerPoint: Designvorlagen": "ppt-ds",
}


def to_code(value):
    """Wandelt einen Klartext-Kursnamen in den Standard-Kurs-Code um."""
    if not value:
        return ""
    return NAMED_CODES.get(str(value).strip(), str(value).strip())


def add_kurs_definitionen_sheet(wb):
    """Erzeugt das Stammdatenblatt 'Kurs_Definitionen' mit den 20 Kurs-Definitionen."""
    ws_def = wb.create_sheet(title="Kurs_Definitionen")
    def_headers = ["Kurs_Code", "Kursname", "Kategorie_ID", "Kategorie_Name", "Vorlage_Offer_ID"]

    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin', color='D9D9D9'), right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'), bottom=Side(style='thin', color='D9D9D9')
    )

    ws_def.append(def_headers)
    for col_idx in range(1, len(def_headers) + 1):
        cell = ws_def.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border

    for row_data in KURS_DEFINITIONEN:
        ws_def.append(list(row_data))

    for row in ws_def.iter_rows(min_row=1, max_row=ws_def.max_row, max_col=len(def_headers)):
        for cell in row:
            if cell.row > 1:
                cell.border = thin_border
                if cell.column == 1:
                    cell.alignment = Alignment(horizontal="center", vertical="center")

    for col in ws_def.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_def.column_dimensions[col_letter].width = max(max_len + 3, 13)

    ws_def.freeze_panes = "A2"
    return ws_def


def generate_schedule():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Terminplanung {PLAN_YEAR}"
    ws.views.sheetView[0].showGridLines = True

    # 1. Feiertage
    feiertage = {
        date(2027, 1, 1): "Neujahr",
        date(2027, 3, 26): "Karfreitag",
        date(2027, 3, 29): "Ostermontag",
        date(2027, 5, 1): "Tag der Arbeit",
        date(2027, 5, 6): "Christi Himmelfahrt",
        date(2027, 5, 17): "Pfingstmontag",
        date(2027, 5, 27): "Fronleichnam",
        date(2027, 10, 3): "Tag der Dt. Einheit",
        date(2027, 10, 31): "Reformationstag",
        date(2027, 11, 1): "Allerheiligen",
        date(2027, 12, 25): "1. Weihnachtstag",
        date(2027, 12, 26): "2. Weihnachtstag",
    }

    # Brückentage (Do -> Fr frei, Di -> Mo frei)
    brueckentage = {
        date(2027, 5, 7): "Brückentag (nach Himmelfahrt)",
        date(2027, 5, 28): "Brückentag (nach Fronleichnam)",
    }

    # Urlaubszeiten (KW 1, KW 16, KW 29-33, KW 51-01)
    urlaub_ranges = [
        (date(2027, 1, 1), date(2027, 1, 8)),
        (date(2027, 4, 19), date(2027, 4, 25)),
        (date(2027, 7, 19), date(2027, 8, 22)),
        (date(2027, 12, 20), date(2028, 1, 9)),
    ]

    def is_urlaub(d):
        for s, e in urlaub_ranges:
            if s <= d <= e:
                return True
        return False

    def is_blocked(d):
        return (d in feiertage) or (d in brueckentage) or is_urlaub(d)

    # 2. Rotierende Prio-3-Permutationen für 11 Zyklen (ohne Software-Doppelung)
    # Slots (jetzt direkt als Kurs-Codes):
    # 0: wrd-serie (Word Seriendruck)
    # 1: ppt-vb    (PowerPoint Präsentation vorbereiten)
    # 2: wrd-dokvorl (Word Dokumentvorlagen)
    # 3: wrd-umfang  (Word Umfangreiche Dokumente)
    # 4: xls-pq-gl   (Excel Power Query Grundlagen)
    # 5: ppt-ds      (PowerPoint Designvorlagen)
    prio3_rotations = [
        ["wrd-serie", "ppt-vb", "wrd-dokvorl", "wrd-umfang", "xls-pq-gl", "ppt-ds"],
        ["wrd-dokvorl", "xls-pq-gl", "wrd-umfang", "wrd-serie", "ppt-ds", "ppt-vb"],
        ["wrd-dokvorl", "ppt-ds", "ppt-vb", "wrd-serie", "xls-pq-gl", "wrd-umfang"],
        ["wrd-serie", "xls-pq-gl", "ppt-ds", "wrd-umfang", "ppt-vb", "wrd-dokvorl"],
        ["xls-pq-gl", "ppt-ds", "wrd-umfang", "wrd-dokvorl", "ppt-vb", "wrd-serie"],
        ["wrd-serie", "ppt-ds", "wrd-dokvorl", "xls-pq-gl", "ppt-vb", "wrd-umfang"],
        ["wrd-dokvorl", "xls-pq-gl", "wrd-serie", "wrd-umfang", "ppt-ds", "ppt-vb"],
        ["wrd-umfang", "xls-pq-gl", "wrd-dokvorl", "wrd-serie", "ppt-vb", "ppt-ds"],
        ["wrd-umfang", "ppt-vb", "wrd-dokvorl", "xls-pq-gl", "ppt-ds", "wrd-serie"],
        ["wrd-serie", "ppt-vb", "ppt-ds", "wrd-umfang", "xls-pq-gl", "wrd-dokvorl"],
        ["wrd-dokvorl", "ppt-ds", "wrd-serie", "wrd-umfang", "xls-pq-gl", "ppt-vb"],
    ]

    # Nicht-lineare Starttage: Di (1), Do (3), Mo (0), Mi (2)
    rot_offsets = [1, 3, 0, 2]

    # Tabellenkopf mit standardisierten Kurs-Code-Spalten
    headers = [
        "Datum", "Tag", "KW", "Monat", "Beginn",
        "Kurs_Code", "Kurs_Code_Prio2", "Kurs_Code_Prio3",
        "Hinweis", "Freigabe", "Sync_Status", "edoobox_ID"
    ]

    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin', color='D9D9D9'), right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'), bottom=Side(style='thin', color='D9D9D9')
    )
    monday_border = Border(
        left=Side(style='thin', color='D9D9D9'), right=Side(style='thin', color='D9D9D9'),
        top=Side(style='medium', color='1F4E79'), bottom=Side(style='thin', color='D9D9D9')
    )
    urlaub_fill = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
    feiertag_fill = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")

    ws.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    start_date = date(PLAN_YEAR, 1, 1)
    end_date = date(PLAN_YEAR, 12, 31)
    current_date = start_date

    calendar_rows = []
    calendar_weeks = {}
    while current_date <= end_date:
        if current_date.weekday() < 5:
            calendar_rows.append(current_date)
            kw = current_date.isocalendar()[1]
            if kw not in calendar_weeks:
                calendar_weeks[kw] = []
            calendar_weeks[kw].append(current_date)
        current_date += timedelta(days=1)

    schedule = {d: {'prio1': '', 'prio2': '', 'prio3': ''} for d in calendar_rows}

    # Nur aktive Unterrichtswochen mit mindestens 3 freien Werktagen
    teaching_kws = [kw for kw in sorted(calendar_weeks.keys())
                    if len([d for d in calendar_weeks[kw] if not is_blocked(d)]) >= 3]

    for idx, kw in enumerate(teaching_kws):
        cycle_num = idx // 4
        week_in_cycle = idx % 4
        rot_offset = rot_offsets[cycle_num % len(rot_offsets)]
        p3_pool = prio3_rotations[cycle_num % len(prio3_rotations)]

        # Aufbau der Wochenstruktur mit dynamisch zugewiesenem Prio-3-Partner
        # Alle Belegungen werden direkt als Kurs-Codes geschrieben.
        if week_in_cycle == 0:
            days_setup = [
                (0, "xls-gl-m1", None, None),
                (1, "ppt-gl-komp", None, p3_pool[0]),
                (2, None, "wrd-gl-komp", p3_pool[1])
            ]
            fr_setup = (None, None)
        elif week_in_cycle == 1:
            days_setup = [
                (0, "xls-gl-m2", None, p3_pool[2]),
                (1, "ppt-ab-komp", None, p3_pool[3]),
                (2, None, "wrd-ab-komp", p3_pool[4])
            ]
            fr_setup = (None, None)
        elif week_in_cycle == 2:
            days_setup = [
                (0, None, "xls-gl-m3", p3_pool[5]),
                (1, "out-gl", "xls-umfang", None),
                (2, "xls-ab-m1", None, None)
            ]
            fr_setup = (None, None)
        else:
            days_setup = [
                (0, "xls-pivot-komp", None, None),
                (1, "out-ab", "xls-ab-m2", None)
            ]
            fr_setup = (None, "xls-gl-m4")

        kw_days = calendar_weeks[kw]
        free_modo = [d for d in kw_days if d.weekday() < 4 and not is_blocked(d)]
        free_fr = [d for d in kw_days if d.weekday() == 4 and not is_blocked(d)]

        used_days_this_week = set()

        for (day_slot, p1_c, p2_c, p3_c) in days_setup:
            target_wd = (day_slot + rot_offset) % 4
            matching = [d for d in free_modo if d.weekday() == target_wd and d not in used_days_this_week]
            if matching:
                assigned_d = matching[0]
            else:
                remaining = [d for d in free_modo if d not in used_days_this_week]
                assigned_d = remaining[0] if remaining else None

            if assigned_d:
                used_days_this_week.add(assigned_d)
                schedule[assigned_d]['prio1'] = to_code(p1_c)
                schedule[assigned_d]['prio2'] = to_code(p2_c)
                schedule[assigned_d]['prio3'] = to_code(p3_c)

        fr_p2, fr_p3 = fr_setup
        if (fr_p2 or fr_p3) and free_fr:
            schedule[free_fr[0]]['prio2'] = to_code(fr_p2)
            schedule[free_fr[0]]['prio3'] = to_code(fr_p3)

    # 3. Schreiben in Excel mit festen Werten (formelfrei)
    weekdays_de = ["Mo", "Di", "Mi", "Do", "Fr"]
    months_de = [
        "Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember"
    ]

    row_num = 2
    for d in calendar_rows:
        weekday = d.weekday()
        ws.cell(row=row_num, column=1, value=d)
        ws.cell(row=row_num, column=1).number_format = "yyyy-mm-dd"

        ws.cell(row=row_num, column=2, value=weekdays_de[weekday])
        ws.cell(row=row_num, column=3, value=d.isocalendar()[1])
        ws.cell(row=row_num, column=4, value=months_de[d.month - 1])

        hinweis = ""
        fill_to_apply = None
        if d in feiertage:
            hinweis = f"Feiertag: {feiertage[d]}"
            fill_to_apply = feiertag_fill
        elif d in brueckentage:
            hinweis = brueckentage[d]
            fill_to_apply = feiertag_fill
        elif is_urlaub(d):
            hinweis = "Urlaub"
            fill_to_apply = urlaub_fill

        if hinweis == "":
            ws.cell(row=row_num, column=5, value="09:00")
            ws.cell(row=row_num, column=6, value=schedule[d]['prio1'])
            ws.cell(row=row_num, column=7, value=schedule[d]['prio2'])
            ws.cell(row=row_num, column=8, value=schedule[d]['prio3'])
            ws.cell(row=row_num, column=10, value="Entwurf")
            ws.cell(row=row_num, column=11, value="Offen")
        else:
            ws.cell(row=row_num, column=9, value=hinweis)

        border_to_use = monday_border if weekday == 0 else thin_border
        for col_idx in range(1, len(headers) + 1):
            c = ws.cell(row=row_num, column=col_idx)
            c.border = border_to_use
            if fill_to_apply and col_idx in [5, 6, 7, 8]:
                c.fill = fill_to_apply
            if col_idx in [1, 2, 3, 4, 5, 10, 11]:
                c.alignment = Alignment(horizontal="center", vertical="center")

        row_num += 1

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 13)

    # 4. Stammdatenblatt automatisch anlegen
    add_kurs_definitionen_sheet(wb)

    wb.save(OUTPUT_FILE)
    print(f"Erfolgreich generiert: {OUTPUT_FILE}")
    print(f"Kurs_Definitionen: {len(KURS_DEFINITIONEN)} Eintraege")


if __name__ == "__main__":
    generate_schedule()
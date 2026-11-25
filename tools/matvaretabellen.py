"""Lager data/matvaretabellen.json: et kompakt utdrag av Matvaretabellen (Mattilsynet).

Kilde: https://www.matvaretabellen.no/api/  (oppgi Matvaretabellen som kilde)
Matvaretabellen oppdateres hver høst. Kjør skriptet på nytt for å hente nye tall:

    python tools/matvaretabellen.py

Hver matvare blir en liste:
    [id, navn, søkeord, kcal, fett, mettet, karbo, sukkerarter, fiber, protein, salt, porsjoner]
Næringsverdier er per 100 g spiselig del. Porsjoner er gram per enhet, f.eks. {"stk": 55, "dl": 100}.
"""
import json
import os
import urllib.request
from datetime import date

URL = 'https://www.matvaretabellen.no/api/nb/foods.json'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'matvaretabellen.json')

NUTRIENTS = ['Fett', 'Mettet', 'Karbo', 'Mono+Di', 'Fiber', 'Protein', 'NaCl']

# Matvaretabellens porsjons-id -> enhetene appen bruker i oppskrifter
PORTIONS = {
    'dl': 'dl', 'stk': 'stk', 'spiseskje': 'ss', 'teskje': 'ts', 'pakke': 'pk', 'boks': 'boks',
    'pose': 'pose', 'glass': 'glass', 'beger': 'beger', 'skive': 'skive', 'fedd': 'fedd',
    'neve': 'neve', 'bukett': 'bunt', 'kopp': 'kopp',
}


def num(v):
    if v is None:
        return None
    v = round(float(v), 2)
    return int(v) if v == int(v) else v


def main():
    req = urllib.request.Request(URL, headers={'User-Agent': 'planlegger-build-script'})
    with urllib.request.urlopen(req, timeout=120) as r:
        foods = json.load(r)['foods']

    out = []
    for f in foods:
        c = {x['nutrientId']: x.get('quantity') for x in f.get('constituents', [])}
        kcal = (f.get('calories') or {}).get('quantity')
        if kcal is None:
            continue
        raw = {p['id']: p['quantity'] for p in f.get('portions', []) if p.get('unit') == 'g' and p.get('quantity')}
        portions = {PORTIONS[k]: num(v) for k, v in raw.items() if k in PORTIONS}
        if 'stk' not in portions:
            for alt in ('stk_middels', 'stk_stor', 'stk_liten'):
                if alt in raw:
                    portions['stk'] = num(raw[alt])
                    break
        out.append([
            f['foodId'], f['foodName'], [k for k in f.get('searchKeywords', []) if k],
            num(kcal), *[num(c.get(n)) for n in NUTRIENTS], portions,
        ])

    data = {
        'source': 'Matvaretabellen, Mattilsynet – matvaretabellen.no',
        'fetched': date.today().isoformat(),
        'fields': ['id', 'name', 'keywords', 'kcal', 'fat', 'satFat', 'carbs', 'sugars', 'fiber', 'protein', 'salt', 'portions'],
        'foods': out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} matvarer -> {os.path.normpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()

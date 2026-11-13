# Aluljáró

Egy egri gyalogos aluljáró graffitijeinek online kiállítása. Az élő oldal:

**https://gyarfasb.github.io/aluljaro-archiv/**

A legújabb bejárás nyílik meg. Ha több dátum van, a csúszkán a régebbiek is megnyithatók. Egyetlen bejárásnál ez a csúszka nem látszik.

## Új bejárás

1. Hozz létre egy mappát, a nap dátumával: `latitasok/2026-11-20/`.
2. Másold bele a Microsoft ICE panorámákat. A név `BAL_1.jpg`, `BAL_2.jpg`, … és `JOBB_1.jpg`, `JOBB_2.jpg`, … A kisebb szám közelebb van a bejárathoz. A jobb falat az oldal fordított sorrendben mutatja; a fájlokat nem kell megfordítani.
3. Ha kell egy mondat a dátum alá, vagy egy lépcsős kép kövesse a festés középvonalát, tegyél a mappába egy `bejaras.yml` fájlt. Minta: `latitasok/2026-11-12/bejaras.yml`. A `path` a kép százalékában van, x balról, y fentről. Ha nincs ilyen fájl, a dátum a mappa neve.
4. Commitold, és pushold a `main` ágra.

A GitHub Action lekicsinyíti a panorámákat, összeállítja az oldalt, és közzéteszi. Az eredeti képek a tárolóban maradnak. A webes méretű képeket nem kell commitolni.

A lap állandó szövegei (cím, bevezető, falak neve) a `site/site.yml` fájlban vannak.

## Első közzététel

A tárolóban: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Ezután a `main` ágra pusholt változat a fenti címen jelenik meg.

Helyben, feltöltés előtt:

```bash
pip install -r scripts/requirements.txt
python scripts/build.py
```

Az eredmény a `dist/` mappa. Nyisd meg a `dist/index.html` fájlt.

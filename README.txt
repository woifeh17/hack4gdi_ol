Bahnorama · Mainz-Test-POIs, Erweiterung Bretzenheim (39 Einträge)

39 POIs mit OSM-Referenzen, davon 14 zusätzliche Objekte in Bretzenheim und entlang der Linie 52.
Umkreis: maximal 5 km um 49.988163202922046, 8.227095627612766.

Dateien:
- src/data/mainzTestPois.js – bestehende Datei ersetzen
- mainzTestPois.csv – tabellarische Ansicht
- mainzTestPois.geojson – Punktdaten für GIS (keine LOD-Modelle)

Einbindung:
import {pois} from './data/mainzTestPois.js';

ACHTUNG: Git-Merge-Konflikt in src/main.js auf Branch main (Commit 42e46f5) zuerst beheben.
Der dynamische createPoiLoader darf das kuratierte Array nicht durch Overpass ersetzen.
Gebäudekandidaten sind mit building.enabled=false markiert; die Modelle sind noch nicht exportiert.
Nicht alle POI-Flächen besitzen überhaupt ein Gebäude. Bei OSM-Referenzen des Typs way
handelt es sich teilweise um Geländeflächen und nicht um konkrete Gebäudeumrisse.
Die Koordinaten sind gerundete OSM-/Mapcarta-Anker und sollten vor präziser AR-Einblendung überprüft werden.

Quellen: Die source-URLs der einzelnen Einträge, © OpenStreetMap contributors (ODbL).

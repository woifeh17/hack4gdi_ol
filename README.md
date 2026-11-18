# Bahnorama

Bahnorama ist eine mobile Web-App, mit der du Sehenswürdigkeiten aus dem Zugfenster entdecken kannst. Die AR-Ansicht blendet Orte und ausgewählte 3D-Gebäude ins Kamerabild ein. Im persönlichen Atlas sammelst du entdeckte Orte und siehst, welche Strecken du bereits gefahren bist.

**[Bahnorama öffnen](https://woifeh17.github.io/hack4gdi_ol/)** · Prototyp aus dem Hack4GDI 2026 mit einem Testgebiet in Mainz.

## App ausprobieren

- **Entdecken (🔍)** öffnet die AR-Ansicht. Aktiviere Kamera, GPS und Bewegungssensoren, wenn die App danach fragt. Tippe auf einen eingeblendeten Ort, um seine Detailkarte zu öffnen und ihn in den Atlas aufzunehmen.
- **Karte und Einstellungen** erreichst du über den Griff am unteren Rand. Die Karte zeigt die Orte, das Schienennetz und die Bahnhofssuche. Mit Start- und Zielbahnhof lässt sich der Kartenausschnitt auf beide Stationen ausrichten. In den Einstellungen kannst du unter anderem POI-Entfernungen und transparente Glasflächen ein- oder ausschalten.
- **Fahrt starten** zeichnet GPS-Punkte auf. Mit **Fahrt beenden** speicherst du die Aufzeichnung im Atlas, sofern verwertbare Standortpunkte vorliegen.
- **Atlas (📖)** zeigt gesammelte Orte und gefahrene Kilometer. Tippe auf einen der Zähler, um die zugehörige Liste aufzuklappen. Die Karte zeigt gesammelte Orte als anklickbare Marker und gespeicherte Fahrten als Heatmap. Wiederholt befahrene Abschnitte werden stärker hervorgehoben.

Ohne GPS verwendet die AR-Ansicht einen Referenzstandort in Mainz. Über **Einstellungen → Entwickleroptionen** kannst du die Blickrichtung manuell einstellen oder kalibrieren. Für einen Demo-Blick Richtung MEWA Arena eignen sich **203° Azimut und 0° Neigung**. Wenn iPhone Safari den Standortzugriff verweigert, öffne die App direkt in einem Safari-Tab und prüfe sowohl die Standortfreigabe für die Website als auch die Ortungsdienste für Safari-Websites.

## Lokal starten

Klone das Repository und starte im Projektordner einen lokalen Webserver. Dafür genügt Python 3.

```bash
git clone https://github.com/woifeh17/hack4gdi_ol.git
cd hack4gdi_ol
python -m http.server 8000
```

Unter Windows kannst du `py -m http.server 8000` verwenden. Öffne danach [http://localhost:8000](http://localhost:8000). Für den Test auf einem Smartphone nutze die veröffentlichte HTTPS-Version. Die App braucht weder einen Build-Schritt noch eine npm-Installation oder ein eigenes Backend. Leaflet, Grundkartenkacheln und externe Bilder werden bei Bedarf über das Netz geladen.

Zum Ausführen der automatisierten Tests benötigst du **Node.js ab Version 20**.

```bash
npm test
```

Die App lässt sich aus dem Repository-Hauptverzeichnis über GitHub Pages veröffentlichen. Der veröffentlichte Projektstand liegt auf `main`.

## Projektstruktur

| Bereich | Aufgabe |
| --- | --- |
| [`index.html`](index.html), [`style.css`](style.css), [`src/main.js`](src/main.js) | Oberfläche, Darstellung und Verbindung der Module |
| [`src/device/`](src/device/) | Kamera, Standort und Geräteorientierung |
| [`src/ar/`](src/ar/) | Perspektivprojektion von POIs und schattierten Gebäudemodellen auf einem Canvas |
| [`src/data/`](src/data/), [`src/poi/`](src/poi/) | POI-Katalog, Zusatzinformationen und bedarfsgerechtes Laden der Gebäudemodelle |
| [`src/map/`](src/map/) | Leaflet-Karte, Schienennetz, Standortmarker und Bahnhofssuche |
| [`src/atlas/`](src/atlas/), [`src/journey/`](src/journey/) | Persönlicher Atlas, GPS-Aufzeichnung und Heatmap |
| [`scripts/`](scripts/), [`.github/workflows/`](.github/workflows/) | Aufbereitung von POI-Informationen und Gebäudegeometrien |

## Daten und Quellen

- **POIs** – Der [Mainzer Testkatalog](src/data/mainzTestPois.js) enthält 39 Orte im Umkreis von bis zu 5 km um den Referenzstandort, darunter Orte in Bretzenheim und entlang der Linie 52. Die [GeoJSON-Datei](mainzTestPois.geojson) enthält die Punktanker für die Nutzung im GIS. In den Detailkarten stehen Quellen, Bildnachweise und die jeweils geltenden Lizenzen. OpenStreetMap-Daten stehen unter der [ODbL](https://www.openstreetmap.org/copyright).
- **Gebäude** – Die App lädt vorberechnete [LoD2-Modelle](assets/buildings/lod2/) und verwendet bei Bedarf [OSM-Grundrisse](assets/buildings/) mit abgeleiteten oder geschätzten Höhen. Amtliche Daten © GeoBasis-DE / LVermGeoRP 2026, [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0), [LVermGeoRP](https://www.lvermgeo.rlp.de), Daten bearbeitet. OSM-Grundrisse © OpenStreetMap-Mitwirkende, ODbL, Auszug von [Geofabrik](https://www.geofabrik.de/data/download.html).
- **Schienennetz und Bahnhöfe** – Deutsche Bahn AG über die [Mobilithek](https://mobilithek.info/offers/922109165921083392), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de). Grundkarte © Esri.

Der Katalog wird zur Laufzeit um die vorberechneten Inhalte in [`poiEnrichment.js`](src/data/poiEnrichment.js) ergänzt. Mit `npm run enrich-pois` lassen sich diese Inhalte aus OSM, Wikidata, Wikipedia und Wikimedia Commons neu erzeugen. Die [Gebäude-Dokumentation](BUILDINGS_README.md) beschreibt den Export lokaler Gebäudegeometrien und amtlicher LoD2-Daten.

## Grenzen des Prototyps

- **AR-Ausrichtung** – Position und Ausrichtung hängen von der Genauigkeit des GPS und der Bewegungssensoren ab. Die vertikale Platzierung ist eine Näherung. Der Prototyp gleicht die Kameraposition weder mit einem Geländemodell noch mit der Lage des Zuges auf dem Gleis ab.
- **Fahrtaufzeichnung** – Die App zeichnet im Vordergrund auf. Kilometer sind Schätzwerte aus aufeinanderfolgenden GPS-Punkten. Ausfälle und unplausible Sprünge trennen die Aufzeichnung in Segmente. Die Heatmap verwendet diese Segmente ohne Abgleich mit dem Schienennetz. Die Bahnhofssuche berechnet derzeit keine Zugroute.
- **Speicherung** – Gesammelte POIs, abgeschlossene Fahrten und Einstellungen liegen im lokalen Speicher des Browsers. Beim Wechsel des Browsers oder beim Löschen der Website-Daten stehen die bisherigen Einträge dort nicht mehr zur Verfügung.

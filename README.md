# WindowLens · Bahn-Atlas

Mobile Web-App für georeferenzierte POIs im Kamerabild, einen persönlichen Atlas und GPS-Fahrtaufzeichnungen.

## Start

Im Repository-Ordner `python -m http.server 8000` ausführen (Windows alternativ `py -m http.server 8000`) und http://localhost:8000 öffnen. Das Projekt verwendet ES-Module ohne Build-Schritt oder Paketinstallation. Die Demo startet mit Blick auf die MEWA Arena. Auf den Marker tippen und den POI zum Atlas hinzufügen.

Für den Mobiltest die App in einem eigenen Tab über HTTPS öffnen, Kamera und Sensoren über ihre Schaltflächen aktivieren und bei relativen Sensorwerten den bekannten Kameraazimut kalibrieren. Für GitHub Pages aus `main` und `/ (root)` deployen, sofern die Repository-Sichtbarkeit und der Tarif das unterstützen.

`npm test` führt die Tests mit Node.js ab Version 20 aus.

## Module

| Modul | Aufgabe |
| --- | --- |
| `src/device/camera.js` | Video, Rückkamera bevorzugen, Kamerawechsel, Stream-Lebenszyklus |
| `src/device/orientation.js` | Absolute und relative Sensordaten, manuelle Orientierung, Kalibrierung |
| `src/device/position.js` | Browser-Geolocation mit Mainz-Fallback |
| `src/ar/pose.js` | Austauschbarer Provider für WGS84-Position und Kamerabasis im lokalen ENU-System |
| `src/ar/geometry.js`, `overlay.js` | Azimut, Distanz und Perspektivprojektion, antippbare Marker |
| `src/data/` | POI-Katalog, Modelle und Detailansicht mit optionaler Bildergalerie |
| `src/atlas/` | Lokale Speicherung und Dashboard |
| `src/journey/recorder.js` | GPS-Segmente und Distanz bei laufender Aufzeichnung |
| `src/main.js` | Verbindet die Module und die Bedienelemente |

## Erweiterung für den Zug

Der Renderer liest pro Frame die Position (`lat`, `lon`, optionale `altitude`) und Kamerabasis (`right`, `up`, `forward`, jeweils Ost/Nord/Oben) aus `getFrame()`. Für einen Zug-Pose-Provider kann die Schienenposition die GPS-Position ersetzen. Die Kamerarotation relativ zum Wagen wird mit dessen Rotation im ENU-System zusammengesetzt. Translation im Wagen und Höhenbezug bei Bedarf im Provider ergänzen. Den Zug-Pose-Provider dann in `main.js` einsetzen.

Die drei Drahtgitter sind geschätzte LOD1-Platzhalter. Das Modellformat verwendet lokale ENU-Koordinaten in Metern und eine Kantenliste. Vermessene Grundrisse, Höhen und LOD2-Dächer können über ein separates Modellmodul ergänzt werden. Für POIs ohne gemeinsame Höhenreferenz wird der Fußpunkt auf Beobachterhöhe gesetzt. Die beiden Sichtfelder sind kalibrierbare Annahmen. Die Projektion berücksichtigt die tatsächliche Bildfläche einschließlich möglicher schwarzer Ränder.

Die Details zeigen aktuell Beschreibung, Koordinaten und Quelle. Die Galerie liest optionale Einträge `photos: [{url, alt, credit}]` aus dem Katalog. Bilddateien und Nutzungsnachweise können pro POI ergänzt werden.

Der Atlas speichert POI-IDs und abgeschlossene Fahrten im Browser. Für eine Fahrt zählen aufeinanderfolgende verwertbare Standortfixes. Signalunterbrechungen und unplausible Sprünge beginnen ein neues Segment, der Mainz-Fallback zählt nie. Die Kilometer sind GPS-Schätzwerte ohne Zuordnung zum Schienennetz. Die App erfasst Fahrten im Vordergrund. Der Atlas bleibt an Browser und Website gebunden.

## Neues GitHub-Repository

Das ZIP entpacken und ein leeres Repository auf GitHub anlegen. Für einen Upload über Git im Projektordner ausführen, wobei `OWNER/REPO` durch das neue Repository ersetzt wird:

```sh
git init -b main
git add .
git commit -m "Initialize WindowLens rail atlas"
git remote add origin https://github.com/OWNER/REPO.git
git push -u origin main
```

Beim Upload über die GitHub-Oberfläche gehören `index.html`, `style.css` und der Ordner `src` direkt ins Repository-Stammverzeichnis. Die übrigen Dateien dokumentieren und testen das Projekt.

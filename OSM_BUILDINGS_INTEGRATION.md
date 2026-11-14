# Bahnorama – dynamische Gebäudegeometrien (OSM Buildings)

## Installation im vorhandenen Repository

Das Patch-ZIP enthält nur neue oder geänderte Dateien und ist **kein eigenständiges Repository**.

1. ZIP lokal entpacken.
2. Die Dateien unter **denselben relativen Pfaden** in das Repository `woifeh17/hack4gdi_ol` übertragen. `src/data/providers/` und `src/poi/` müssen dabei neu entstehen. `index.html`, `style.css`, `src/main.js`, `src/ar/overlay.js` und `src/data/pois.js` werden ersetzt.
3. Auf GitHub nach `main` committen und die GitHub-Pages-Version neu laden (bei Bedarf Browser-Cache umgehen).
4. `npm test` sollte **13 Tests** erfolgreich ausführen (Node.js >= 20).

Der Browser braucht **keinen Build-Schritt** und weiterhin keinen eigenen Backend-Server. Mobile Kamera und Sensoren benötigen HTTPS.

## Was der Patch macht

- Nur POIs mit `building.enabled: true` sind für dynamisches Laden vorgesehen.
- Der POI-Manager wählt höchstens 3 relevante Gebäude innerhalb von 3 km und 105° zum Kamerazimut aus. Ohne gültige Kamerarichtung zählt nur die Entfernung.
- Der Provider lädt zunächst die benötigten OSM-Buildings-GeoJSON-Kacheln bei Zoom 15 (höchstens 9 Kacheln pro POI). Gemeinsame Kacheln werden nur einmal angefragt.
- Falls die öffentliche OSM-Buildings-Schnittstelle nicht erreichbar ist, keine passenden Daten liefert oder CORS verhindert, nutzt der Provider für diesen POI eine kleine Overpass-Abfrage auf OSM-Gebäude und Gebäudeteile. Erforderliche Antwort: JSON inkl. Geometrien.
- Die Anwendung wählt ein Gebäude beim POI (per OSM-ID, falls eingetragen, sonst räumlich/namensbasiert), konvertiert dessen Fußabdruck in lokal metrische ENU-Koordinaten und extrudiert ihn.
- Gebäudemodelle liegen ausschließlich in einem begrenzten **RAM-LRU-Cache**; es findet keine dauerhafte lokale Speicherung der Modelle statt. Die bereits vorhandene Atlas-Speicherung bleibt unabhängig.
- Eine fehlerhafte Anfrage hält die AR-Ansicht nicht auf: Bis zur erfolgreichen Übertragung bleiben die bisherigen Box-Drahtgitter als Platzhalter erhalten.
- `buildingGeometry.js` projiziert und clippt auch Kanten, die teilweise außerhalb des Kamerasichtfeldes liegen.

## Einstellungen und POI-Zuordnung

In `src/data/pois.js` können Modelle pro POI aktiviert werden, zum Beispiel:

```js
{
  id: 'arena', name: 'MEWA Arena', lat: 49.983956, lon: 8.224387,
  building: {
    enabled: true,
    searchRadiusM: 240,
    defaultHeight: 28,
    // osmId: 'way/123456' // Platzhalter! Echte OSM-Way-/Relation-ID eintragen.
  },
}
```

Der Patch aktiviert die dynamischen Geometrien für MEWA-Arena, Forschungsreaktor und Bahnhof Mainz-Gonsenheim. Die übrigen, nicht gebäudebezogenen POIs bleiben Marker. Für verlässliche Zuordnung sollte man die **echte OSM-Way- oder Relation-ID** ergänzen – insbesondere für große Komplexe wie die Arena. Die automatische räumliche Auswahl kann sonst ein benachbartes Gebäude erwischen.

Folgende Parameter lassen sich in `src/poi/visibilityManager.js` anpassen: `maxDistanceM`, `preloadAngle`, `maxCount`, `maxConcurrent`, `maxModels`, `updateEveryMs` und `retryAfterMs`.

### OSM-Buildings-Endpunkt

Standardmäßig ist die `anonymous`-Tile-URL aus dem öffentlichen OSM-Buildings-GitHub-Beispiel hinterlegt. **Die öffentliche Erreichbarkeit dieser URL ist nicht garantiert**. Sie kann beispielsweise CORS-Fehler, 403/404 oder Zeitüberschreitungen liefern. Der Patch verwendet dann Overpass. Die öffentlich sichtbare Token-ID aus der aktuellen OSM-Buildings-Demoseite wurde **nicht** als Zugangsschlüssel übernommen.

Zum Konfigurieren einer ausdrücklich freigegebenen OSM-Buildings-Tile-URL in `src/main.js`:

```js
const buildingProvider = createOSMBuildingsProvider({
  tileTemplate: 'https://{s}.data.osmbuildings.org/0.2/DEIN_TOKEN/tile/{z}/{x}/{y}.json',
});
```

**Achtung:** Ein im Frontend eingetragener Token wird im öffentlichen Repository sichtbar. Falls ein privater API-Schlüssel erforderlich ist, muss dieser über ein Backend/Proxy geschützt werden. Zur reinen Erprobung kann der Tile-Abruf mit `tileTemplate: null` deaktiviert werden, dann wird **direkt Overpass** abgefragt.

## Testen

1. Die App auf GitHub Pages öffnen. Ohne GPS verwendet Bahnorama weiterhin den Mainz-Demostandort.
2. Der manuelle Azimut `203°` blickt ungefähr in Richtung MEWA-Arena; Neigung zum Test zunächst `0°`.
3. Netzwerkanfragen in den Entwicklertools kontrollieren. Der Browser sollte nur Kacheln in der Nähe relevanter POIs anfordern, nicht die komplette Stadt.
4. Die Statuszeile oberhalb der Schaltflächen meldet geladene Gebäude, laufende Abrufe und fehlende Modelle.
5. Das bisherige Boxmodell bleibt bestehen, bis eine vollständige GeoJSON-Geometrie geladen und ausgewählt werden konnte.
6. Bei leerem Ergebnis die tatsächliche OSM-Gebäude-ID/den Suchradius prüfen. Bei HTTP-/CORS-Problemen den Overpass-Fallback beziehungsweise `tileTemplate:null` testen.

## Wichtige fachliche Grenzen

- Der Renderer zeichnet **zunächst weiterhin Kanten/Drahtgitter** auf das Kamerabild, keine opaken/verschatteten 3D-Flächen. Geschlossene Oberflächen und korrektes Depth-Testing gehören in einen späteren WebGL-Schritt.
- LOD1 bedeutet hier: OSM-Grundriss extrudiert auf die aus OSM-Tags bestimmte oder geschätzte Höhe. Für rechteckige Grundrisse mit `roof:shape=gabled` und `roof:height` wird zusätzlich ein vereinfachter Satteldachfirst angezeigt (LOD2-ähnlich). **Nicht alle OSM-Dachtypen sind implementiert.** Das ist keine amtliche LOD2-Geometrie.
- Das LOD2-Dach ist eine geometrische Näherung, die für komplexe Dachgeometrien, `building:part`-Ensembles und ungewöhnliche Grundrisse noch erweitert werden muss.
- Es wird **noch kein Höhenmodell/DEM** einbezogen. Sind keine konsistenten absoluten Höhen vorhanden, setzt der Renderer den Gebäudefuß auf Beobachterhöhe. Dadurch kann die vertikale AR-Lage auf realem Gelände abweichen.
- Für große Gebäudekomplexe können mehrere OSM-Objekte nötig sein. Die aktuelle erste Version wählt ein Hauptfeature; es werden nicht automatisch alle zugehörigen `building:part`-Objekte zusammengesetzt.
- OSM-Buildings-Tiles und öffentliche Overpass-Instanzen haben keine zugesicherte Verfügbarkeit. Für eine stark genutzte App sollte ein eigener Caching-Proxy oder ein lizenzierter Datenzugang geplant werden.

**Datenhinweis:** © OpenStreetMap-Mitwirkende (ODbL); Hinweise und Nutzungsbedingungen von OSM Buildings zusätzlich beachten. Die Attribution wird durch den Patch sichtbar in der Anwendung angezeigt.

Dokumentation:
- https://github.com/OSMBuildings/OSMBuildings/blob/master/docs/server.md
- https://osmbuildings.org/documentation/viewer/api/
- https://overpass.ch/de/examples/buildings-in-an-area
- https://www.openstreetmap.org/copyright

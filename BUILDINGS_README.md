# WindowLens: static OSM building footprints + shaded AR

## Overview

This patch replaces **live OSM Buildings/Overpass calls** with **one GeoJSON file per eligible POI** hosted on the *same* GitHub Pages site as WindowLens. The AR overlay loads these geometries only when the existing `visibilityManager.js` schedules a building. No runtime OSM requests or cross-origin dependencies.

### What is real and what is estimated?

- The **footprint** is an actual OpenStreetMap way extracted from Geofabrik's Rheinland-Pfalz raw OSM `.pbf` file. Only ways with `building=*` or `building:part=*` are exported.
- **Heights** use OSM `height=*` if present, otherwise OSM `building:levels`, otherwise a per-type **estimated default**. These defaults are not surveyed heights.
- **LOD1**: walls and horizontal roof, respecting OSM outlines; open courtyards/holes if present in the source polygon.
- **LOD2 approximation**: roofs are sloped only where OSM explicitly has `roof:shape=gabled` and `roof:height=*` on a suitable quadrilateral building. No claims of full authentic LOD2 geometry.
- Old `boxModel` placeholders remain outlines until their real footprint can be exported. Nature, gardens, cemeteries etc. are not faked into buildings.
- Terrain-height differences are not yet handled. Building baselines use the POI anchor's local vertical reference; vertical placement can be inaccurate on sloped terrain.
- Renderer: efficient Canvas2D, camera-space frustum clipping, face occlusion approximation by depth sort, directional lighting, backface culling, translucent walls/roofs, limited 3D face complexity. No WebGL framework or new frontend dependency.

## Installation

Merge this patch's folders into the repository root **without deleting existing files**. Important replacements: `index.html`, `src/main.js`, `src/ar/overlay.js`, and `src/poi/visibilityManager.js`. New modules: `src/ar/meshGeometry.js`, `src/ar/shadedBuildings.js`, `src/ar/visibilityConfig.js`, `src/data/buildingManifest.js`, `src/data/providers/localBuildings.js`. Add the `scripts/`, `.github/workflows/` and `assets/buildings/` files too.

**By design, the initial `assets/buildings/manifest.json` is empty**. That prevents accidental requests for files that have not been produced yet.

### Generate actual local GeoJSON assets on GitHub (recommended)

1. Commit this patch to the repository, then open **Actions > Export Mainz OSM buildings > Run workflow**.
2. The job downloads the Geofabrik Rheinland-Pfalz `.osm.pbf`, installs `osmium`, extracts tagged OSM building ways from the catalogue and uploads a downloadable artifact named **windowlens-mainz-buildings**.
3. Download that artifact from the successful workflow run. Extract its `assets/buildings/` folder into the repository root and commit those generated files on the normal `main` branch.
4. Once GitHub Pages rebuilds the human-uploaded commit, the manifest is fetched on startup; only successfully exported buildings are enabled. GeoJSON files are fetched on demand while exploring.
5. Inspect the workflow log for `OK` versus `SKIP`. Some POI OSM IDs are area/grounds objects rather than building outlines; those are correctly excluded. For those POIs, identify and add an appropriate building-way ID before rerunning.

We deliberately do not have the workflow push directly using `GITHUB_TOKEN`: GitHub does not rebuild a branch-published Pages site for bot pushes made with this token. The human commit in step 3 triggers deployment normally.

### Local (alternative)

- Download `https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf` (large one-time regional download).
- `python -m pip install osmium`
- `python scripts/export_mainz_buildings.py /path/to/rheinland-pfalz-latest.osm.pbf`
- Commit `assets/buildings/*.geojson` and `assets/buildings/manifest.json`.

### Test

`node --test test/shaded-buildings.test.js` for new modules; `npm test` for the complete repository.

### Copyright

OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0. Extract delivered by Geofabrik. Keep the existing visible OSM attribution in WindowLens.

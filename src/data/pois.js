import {boxModel} from "./models.js";

export const pois = [
  // Beibehalten aus v3:
  {id:'arena', model:boxModel(165, 190, 28), name:'MEWA Arena', lat:49.983956, lon:8.224387, subtitle:'Fußballstadion · 1. FSV Mainz 05', source:'https://www.outdooractive.com/de/poi/rheinhessen/mewa-arena/25271942/'},
  {id:'garten', name:'Botanischer Garten JGU', lat:49.990938, lon:8.240678, subtitle:'Botanischer Garten · Universität Mainz', source:'https://www.outdooractive.com/de/poi/rheinhessen/botanischer-garten-der-johannes-gutenberg-universitaet-mainz/12023487/'},

  // Neue, räumlich verteilte POIs rund um 49.9881632 N, 8.2270956 E:
  // Quelle: OpenStreetMap-POIs, abgeglichen mit den verlinkten Karteneinträgen.
  {id:'aquaedukt', name:'Römisches Aquädukt · Infotafel', lat:49.98774, lon:8.22961, subtitle:'Informationstafel zur römischen Wasserleitung', source:'https://mapcarta.com/de/N13469955871'},
  {id:'friedhof', name:'Neuer Jüdischer Friedhof', lat:49.98563, lon:8.23285, subtitle:'Geschütztes Kulturdenkmal · Mainz-Bretzenheim', source:'https://mapcarta.com/de/W275819547'},
  {id:'coface', name:'Coface-See', lat:49.99437, lon:8.22303, subtitle:'Wasserfläche · Kisselberg', source:'https://mapcarta.com/W227025898'},
  {id:'reaktor', model:boxModel(30, 30, 16), name:'Forschungsreaktor Mainz', lat:49.992413, lon:8.237325, subtitle:'Forschungseinrichtung · Johannes Gutenberg-Universität', source:'https://de.wikipedia.org/wiki/Forschungsreaktor_Mainz'},
  {id:'gonsenheim', model:boxModel(18, 9, 7), name:'Bahnhof Mainz-Gonsenheim', lat:49.99774, lon:8.21431, subtitle:'Regionalbahnhalt · Mainz-Gonsenheim', source:'https://mapcarta.com/de/18094116'},
];

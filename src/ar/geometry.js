const RAD = Math.PI / 180;
export function normalize360(degrees) {
  return ((degrees % 360) + 360) % 360;
}
const dot = (u, v) => u[0]*v[0] + u[1]*v[1] + u[2]*v[2];
const blend = (u, v, a, b) => [a*u[0]+b*v[0], a*u[1]+b*v[1], a*u[2]+b*v[2]];

// (east, north, up): die Rückkamera blickt entlang der NEGATIVEN Geräte-z-Achse.
// screenAngle: Browser-/CSS-Screen-Rotation in Grad (0, 90, 180, 270).
export function cameraPoseFromEuler(alpha, beta, gamma, screenAngle = 0, yawOffset = 0, pitchOffset = 0, facing = 'environment') {
  if (![alpha, beta, gamma, screenAngle, yawOffset, pitchOffset].every(Number.isFinite)) return null;
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cg = Math.cos(g), sg = Math.sin(g);
  // Spalten der Matrix Rz(alpha)*Rx(beta)*Ry(gamma).
  const axisX = [ca*cg - sa*sb*sg, sa*cg + ca*sb*sg, -cb*sg];
  const axisY = [-sa*cb, ca*cb, sb];
  const axisZ = [ca*sg + sa*sb*cg, sa*sg - ca*sb*cg, cb*cg];
  const t = screenAngle * RAD;
  let right = blend(axisX, axisY, Math.cos(t), Math.sin(t));
  let up = blend(axisX, axisY, -Math.sin(t), Math.cos(t));
  let forward = axisZ.map(v => -v);
  if (facing === 'user') { // Frontkamera: Blickrichtung andersherum.
    forward = forward.map(v => -v);
    right = right.map(v => -v);
  }
  if (pitchOffset !== 0) {
    const p = pitchOffset * RAD;
    const oldForward = forward, oldUp = up;
    forward = blend(oldForward, oldUp, Math.cos(p), Math.sin(p));
    up = blend(oldUp, oldForward, Math.cos(p), -Math.sin(p));
  }
  if (yawOffset !== 0) {
    const t = yawOffset * RAD, c = Math.cos(t), s = Math.sin(t);
    // Positive geographische Azimutkorrektur: von Nord nach Ost.
    const yaw = v => [c*v[0] + s*v[1], -s*v[0] + c*v[1], v[2]];
    forward = yaw(forward); right = yaw(right); up = yaw(up);
  }
  const flatLength = Math.hypot(forward[0], forward[1]);
  return {
    forward, right, up,
    heading: flatLength < 0.06 ? null : normalize360(Math.atan2(forward[0], forward[1]) / RAD),
    pitch: Math.abs(forward[2]) < 1e-12 ? 0 : Math.atan2(forward[2], flatLength) / RAD,
  };
}

// Rodrigues-Rotation eines Vektors v um die Einheitsachse k (Rechtssystem).
function rotateAroundAxis(v, k, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const cross = [k[1]*v[2] - k[2]*v[1], k[2]*v[0] - k[0]*v[2], k[0]*v[1] - k[1]*v[0]];
  const d = dot(k, v);
  return [
    v[0]*c + cross[0]*s + k[0]*d*(1 - c),
    v[1]*c + cross[1]*s + k[1]*d*(1 - c),
    v[2]*c + cross[2]*s + k[2]*d*(1 - c),
  ];
}

// Neigungskompensierte Kamerapose für iOS/Safari.
// webkitCompassHeading ist der Azimut (im Uhrzeigersinn ab Nord) der auf die
// Horizontalebene projizierten Geräte-y-Achse (Oberkante) – NICHT das W3C-alpha.
// webkitCompassHeading einfach als alpha in die Euler-Formel zu stecken ergibt
// Sprünge, sobald das Telefon aufrecht gehalten wird (beta ~ 90°): Dort
// misst alpha eine Rotation um die (waagerechte) Geräte-z-Achse, während der
// Kompasskurs die Oberkante beschreibt – beide Werte divergieren chaotisch.
// Stattdessen: Erdvertikale aus beta/gamma rekonstruieren, den Horizont mit
// dem Kompasskurs ausrichten und die Kameraachsen direkt hineinprojizieren.
// heading: null, wenn die y-Achse fast senkrecht steht (Kompassazimut dann
// nicht bestimmbar – die Aufruferschicht hält dann den letzten Kurs).
export function cameraPoseFromCompass(beta, gamma, compassHeading, screenAngle = 0, yawOffset = 0, pitchOffset = 0, facing = 'environment') {
  if (![beta, gamma, compassHeading, screenAngle, yawOffset, pitchOffset].every(Number.isFinite)) return null;
  const b = beta * RAD, g = gamma * RAD;
  const cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // Erdvertikale (up) in Gerätekoordinaten – hängt nur von beta/gamma ab.
  const u = [-cb*sg, sb, cb*cg];
  const u2 = u[2]; // z-Komponente: Neigung der Kamerablickrichtung
  const pitch = Math.atan2(-u2, Math.sqrt(Math.max(0, 1 - u2*u2))) / RAD;

  const y = [0, 1, 0];
  const yh = blend(y, u, 1, -dot(y, u)); // horizontale Projektion der Oberkante
  const m = Math.hypot(yh[0], yh[1], yh[2]);
  if (m < 0.05) {
    // Oberkante fast senkrecht (Telefon aufrecht): Azimut nicht berechenbar.
    return {forward: null, right: null, up: null, heading: null, pitch};
  }
  const yhUnit = [yh[0]/m, yh[1]/m, yh[2]/m];
  // Positive Rechtssystem-Rotation um up (von oben im Uhrzeigersinn)
  // senkt den Azimut um θ. Von Azimut H auf Nord (0) drehen: +H.
  const north = rotateAroundAxis(yhUnit, u, compassHeading * RAD);
  // Ost = Nord + 90° Azimut = Rotation um −90°.
  const east = rotateAroundAxis(north, u, -Math.PI / 2);
  const toEarth = v => [dot(v, east), dot(v, north), dot(v, u)];

  const x = [1, 0, 0];
  const t = screenAngle * RAD;
  let right = toEarth(blend(x, y, Math.cos(t), Math.sin(t)));
  let up = toEarth(blend(x, y, -Math.sin(t), Math.cos(t)));
  let forward = toEarth([0, 0, -1]); // Rückkamera: negative Geräte-z-Achse
  if (facing === 'user') {
    forward = forward.map(v => -v);
    right = right.map(v => -v);
  }
  if (pitchOffset !== 0) {
    const p = pitchOffset * RAD;
    const oldForward = forward, oldUp = up;
    forward = blend(oldForward, oldUp, Math.cos(p), Math.sin(p));
    up = blend(oldUp, oldForward, Math.cos(p), -Math.sin(p));
  }
  if (yawOffset !== 0) {
    const t2 = yawOffset * RAD, c = Math.cos(t2), s = Math.sin(t2);
    const yaw = v => [c*v[0] + s*v[1], -s*v[0] + c*v[1], v[2]];
    forward = yaw(forward); right = yaw(right); up = yaw(up);
  }
  const flatLength = Math.hypot(forward[0], forward[1]);
  return {
    forward, right, up,
    heading: flatLength < 0.06 ? null : normalize360(Math.atan2(forward[0], forward[1]) / RAD),
    pitch: Math.abs(forward[2]) < 1e-12 ? 0 : Math.atan2(forward[2], flatLength) / RAD,
  };
}

// Für den Laptop und die Sensor-Fallback-Steuerung: waagerechter Horizont, kein Roll.
export function manualCameraPose(headingDegrees, pitchDegrees) {
  if (![headingDegrees, pitchDegrees].every(Number.isFinite)) return null;
  const h = headingDegrees * RAD, p = pitchDegrees * RAD;
  const sh = Math.sin(h), ch = Math.cos(h), sp = Math.sin(p), cp = Math.cos(p);
  return {
    heading: normalize360(headingDegrees), pitch: pitchDegrees,
    forward: [sh*cp, ch*cp, sp],
    right: [ch, -sh, 0],
    up: [-sh*sp, -ch*sp, cp],
  };
}

// Ziel als Richtungsvektor (Azimut, Elevation) auf die Kameraebene projizieren.
// x/y in [0,1], Ursprung oben links. Null => außerhalb des Frustums.
// Inkl. Roll; horizontale und vertikale Field-of-View sind vorerst schätzbar.
export function projectPoi(poiBearing, poiElevation, pose, horizontalFov, verticalFov) {
  if (!pose || ![poiBearing, poiElevation, horizontalFov, verticalFov].every(Number.isFinite)) return null;
  if (horizontalFov <= 0 || horizontalFov >= 179 || verticalFov <= 0 || verticalFov >= 179) return null;
  const h = poiBearing * RAD, e = poiElevation * RAD;
  const target = [Math.sin(h)*Math.cos(e), Math.cos(h)*Math.cos(e), Math.sin(e)];
  const depth = dot(target, pose.forward);
  if (depth <= 0.00001) return null;
  const x = 0.5 + dot(target, pose.right) / (2 * depth * Math.tan(horizontalFov*RAD/2));
  const y = 0.5 - dot(target, pose.up) / (2 * depth * Math.tan(verticalFov*RAD/2));
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? {x,y} : null;
}

// Geodätische Kugelnäherung für WGS84-Koordinaten (lat, lon in Grad).
// Entfernung in Metern, Anfangsazimut in Grad (0°=N, 90°=O).
// Für POIs in Mainz ausreichend; Höhen und Gelände bleiben unberücksichtigt.
export function distanceAndBearing(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite) ||
      Math.abs(lat1) > 90 || Math.abs(lat2) > 90 || Math.abs(lon1) > 180 || Math.abs(lon2) > 180) return null;
  const phi1 = lat1 * RAD, phi2 = lat2 * RAD;
  const deltaPhi = (lat2 - lat1) * RAD, deltaLambda = (lon2 - lon1) * RAD;
  const a = Math.sin(deltaPhi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(deltaLambda/2)**2;
  const distance = 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0,1-a)));
  const y = Math.sin(deltaLambda)*Math.cos(phi2);
  const x = Math.cos(phi1)*Math.sin(phi2) - Math.sin(phi1)*Math.cos(phi2)*Math.cos(deltaLambda);
  const bearing = distance < 0.01 ? null : normalize360(Math.atan2(y, x)/RAD);
  return {distance, bearing};
}
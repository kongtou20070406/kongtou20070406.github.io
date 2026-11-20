import { writeFileSync } from "node:fs";
import { criticalImpact, inverseRadiusAt, observerRadius, traceLightRay } from "../light-rays.mjs";

const output = process.argv[2];
if (!output) {
  throw new Error("Usage: node tools/render-black-hole.mjs <output.ppm>");
}

const width = 1440;
const height = 1080;
const pixels = Buffer.alloc(width * height * 3);
const radians = Math.PI / 180;
const inclination = 78 * radians;
const sinInclination = Math.sin(inclination);
const cosInclination = Math.cos(inclination);
const observerLapse = Math.sqrt(1 - 2 / observerRadius);
const diskInner = 6;
const diskOuter = 34;
const sensorHeight = 33;
const tau = 2 * Math.PI;
const orbitCache = new Map();

function smoothstep(start, end, value) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function sky(x, y, z) {
  const sx = (Math.atan2(y, x) / tau + .5) * 280;
  const sy = (Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI + .5) * 140;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const seed = hash(ix, iy);
  const dx = sx - ix - (.2 + .6 * hash(ix + 17, iy));
  const dy = sy - iy - (.2 + .6 * hash(ix, iy + 39));
  const radius = .025 + .055 * seed ** 6;
  const star = seed > .925 ? (seed - .9) * Math.exp(-(dx * dx + dy * dy) / (radius * radius)) : 0;
  const haze = .00035 + .0007 * Math.exp(-7 * (z + .32 * y) ** 2);
  return [.76 * haze + .94 * star, .84 * haze + .94 * star, 1.45 * haze + star];
}

function diskLight(radius, azimuth, axialImpact) {
  // Circular Keplerian emitters. axialImpact is the angular momentum per
  // energy of the future-directed photon reaching the observer.
  const frequencyRatio = Math.sqrt(1 - 3 / radius) /
    (observerLapse * (1 - axialImpact / radius ** 1.5));
  const edge = smoothstep(diskInner, 7.3, radius) * (1 - smoothstep(26, diskOuter, radius));
  const shear = azimuth + .22 * radius;
  const ripples = .70 + .20 * Math.sin(4.7 * radius + 1.8 * Math.sin(7 * shear)) +
    .10 * Math.sin(10.9 * radius + 3.6 * Math.cos(5 * shear));
  const texture = ripples * (.85 + .15 * Math.cos(3 * shear + .6 * Math.sin(9 * azimuth)));
  const radiance = 5.8 * (7.6 / radius) ** 2.9 * edge * texture * frequencyRatio ** 4;
  const heat = smoothstep(.27, .99, (8.3 / radius) ** .62 * frequencyRatio);
  return [radiance, radiance * (.18 + .54 * heat), radiance * (.045 + .40 * heat ** 2)];
}

function orbitFor(impact) {
  // The orbit changes rapidly across the critical curve. Trace those pixels
  // at their exact impact rather than sharing the radial lookup bin.
  if (Math.abs(impact - criticalImpact) < .055) {
    return traceLightRay(impact, .00625);
  }

  const key = Math.max(1, Math.round(impact * 500));
  if (!orbitCache.has(key)) {
    orbitCache.set(key, traceLightRay(key / 500));
  }
  return orbitCache.get(key);
}

function colorFor(sensorX, sensorY) {
  const distance = Math.hypot(sensorX, sensorY);
  const impact = observerRadius * distance / (Math.hypot(observerRadius, distance) * observerLapse);
  const right = sensorX / distance;
  const up = sensorY / distance;
  const orbit = orbitFor(impact);
  const axialImpact = -impact * sinInclination * right;

  // The z coordinate of the ray direction is A cos φ + B sin φ.
  // Its zeros locate exact crossings of the equatorial plane in angle.
  const firstCrossing = Math.atan2(cosInclination, -sinInclination * up);
  for (let angle = firstCrossing; angle < orbit.endAngle; angle += Math.PI) {
    const radius = 1 / inverseRadiusAt(orbit, angle);
    if (radius >= diskInner && radius <= diskOuter) {
      const x = sinInclination * Math.cos(angle) - cosInclination * up * Math.sin(angle);
      const y = right * Math.sin(angle);
      return diskLight(radius, Math.atan2(y, x), axialImpact);
    }
  }

  if (orbit.outcome === "escaped") {
    const cos = Math.cos(orbit.endAngle);
    const sin = Math.sin(orbit.endAngle);
    return sky(sinInclination * cos - cosInclination * up * sin, right * sin, cosInclination * cos + sinInclination * up * sin);
  }
  return [0, 0, 0];
}

function toByte(radiance) {
  const linear = 1 - Math.exp(-radiance);
  const encoded = linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055;
  return Math.round(255 * encoded);
}

for (let y = 0; y < height; y++) {
  const sensorY = (height / 2 - y - .5) * sensorHeight / height;
  for (let x = 0; x < width; x++) {
    const sensorX = (x + .5 - width / 2) * sensorHeight / height;
    const rgb = colorFor(sensorX, sensorY);
    const pixel = (y * width + x) * 3;
    pixels[pixel] = toByte(rgb[0]);
    pixels[pixel + 1] = toByte(rgb[1]);
    pixels[pixel + 2] = toByte(rgb[2]);
  }
}

writeFileSync(output, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));

// kongtou — a fogged window at blue hour.
// Glass space: x in [0, aspect], y in [0, 1] with y = 0 at the top; one unit = the canvas height.
// Condensation sits on the room side of the glass, so it is lit by the room and reflects it.

const DEBUG_SHOT = typeof location !== "undefined" && location.search.includes("shot");
const MAX_SEGMENTS = 96;
const MAX_DROPS = 700;

// Where things sit inside the room photo (fractions of its width and height, y down).
// Filled in from the generated room image; the screen and the clock are drawn live on top.
export const ROOM = {
  // inner screen corners: top-left, top-right, bottom-right, bottom-left
  screen: [0.0849, 0.2742, 0.2291, 0.3401, 0.2356, 0.5654, 0.0927, 0.5909],
  // centre x, centre y, face radius (fraction of the image height)
  clock: [0.8331, 0.119, 0.0595],
};

export function createGlass(canvas, options = {}) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: location.search.includes("shot") });
  if (!gl) return null;
  const floatTargets = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------ shaders

  const VERTEX = `#version 300 es
  out vec2 vUv;
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const NOISE = `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
  float worley(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float d = 8.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(x, y);
        vec2 r = g + hash22(i + g) - f;
        d = min(d, dot(r, r));
      }
    return sqrt(d);
  }
  vec2 cover(vec2 uv, float screenAspect, float imageAspect, float zoom, vec2 shift) {
    vec2 s = screenAspect > imageAspect ? vec2(1.0, imageAspect / screenAspect) : vec2(screenAspect / imageAspect, 1.0);
    s /= zoom;
    vec2 c = clamp(vec2(0.5) + shift, s * 0.5, 1.0 - s * 0.5);
    return c + (uv - 0.5) * s;
  }`;

  // The view outside: the photograph, with live snow falling in front of it.
  // Stored at half brightness for headroom; alpha carries the light sources for halos.
  const SCENE = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uView, uLights;
  uniform float uTime, uViewAspect, uHasView;
  uniform vec3 uSky;
  uniform vec2 uRes, uParallax;
  ${NOISE}
  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 iuv = cover(vUv, aspect, uViewAspect, 1.06, uParallax * 0.012);
    vec3 col = texture(uView, iuv).rgb;
    float lights = texture(uLights, iuv).r;
    float lampGlow = textureLod(uLights, iuv, 3.0).r * 5.0 + textureLod(uLights, iuv, 5.0).r * 6.0;

    // the photo is blue hour; regrade it to the visitor's time of day (uSky: day, night, warm)
    float day = uSky.x, night = uSky.y, warm = uSky.z;
    float skyPart = smoothstep(0.42, 0.62, iuv.y);           // the open sky above the roofline
    float lum0 = dot(col, vec3(0.3, 0.55, 0.15));
    vec3 lit = col * lights;                                  // lamps and windows, kept as they are
    // daytime after snow: overcast, pale and grey; the building reads in its own colour
    vec3 dayCol = mix(vec3(lum0) * vec3(0.95, 0.98, 1.02) * 1.9 + 0.12, col * 1.7 + 0.06, 0.35);
    dayCol = mix(dayCol, vec3(0.78, 0.81, 0.86) - (iuv.y - 0.6) * 0.18, skyPart * 0.85);
    col = mix(col, dayCol, day);
    // deep night: the sky sinks to near black blue, the lit windows stay
    col = mix(col, col * vec3(0.32, 0.36, 0.5) + lit * 0.9, night);
    // dawn and dusk: a warm band low in the sky
    col += vec3(0.32, 0.15, 0.08) * warm * skyPart * smoothstep(0.95, 0.5, iuv.y);
    // stars: only in the open sky, only when it is dark enough; they twinkle a little
    vec2 sp = vec2(iuv.x * uViewAspect, iuv.y) * 130.0;
    vec2 sid = floor(sp);
    float sr = hash12(sid + 7.0);
    float dark = clamp(night + 0.35 * (1.0 - day - night), 0.0, 1.0);
    float bright = smoothstep(0.988 - 0.008 * night, 1.0, sr);
    float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * hash12(sid + 3.0)) + sr * 40.0);
    float star = bright * smoothstep(0.16, 0.0, length(fract(sp) - 0.5 - (hash22(sid) - 0.5) * 0.6)) * twinkle;
    col += vec3(0.9, 0.94, 1.0) * star * dark * smoothstep(0.55, 0.75, iuv.y) * 1.6;
    float lightsOn = 1.0 - 0.85 * day + 0.6 * night;
    lights *= lightsOn;
    lampGlow *= lightsOn;
    // the brightest stars also glow faintly through the fog, like distant lamps
    float starHalo = bright * smoothstep(0.5, 0.0, length(fract(sp) - 0.5 - (hash22(sid) - 0.5) * 0.6)) * twinkle;
    lights += starHalo * dark * smoothstep(0.55, 0.75, iuv.y) * 1.6;
    if (uHasView < 0.5) {
      col = mix(vec3(0.42, 0.48, 0.66), vec3(0.04, 0.08, 0.2), smoothstep(0.3, 1.0, vUv.y));
      lights = 0.0;
    }

    // falling snow, four depths; nearer flakes are larger, faster and out of focus
    vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y);
    for (int i = 0; i < 4; i++) {
      float fi = float(i) / 3.0;
      float scale = mix(38.0, 7.5, fi);
      vec2 q = (p + uParallax * 0.004 * (1.0 + fi * 3.0)) * scale;
      q.y += uTime * mix(0.5, 1.45, fi);
      q.x += sin(uTime * 0.31 + q.y * 0.19 + fi * 7.0) * 0.5;
      vec2 id = floor(q);
      vec2 f = fract(q) - 0.5;
      float rnd = hash12(id + fi * 31.0);
      if (rnd > 0.5) {
        vec2 offset = (hash22(id + 3.7) - 0.5) * 0.6;
        float size = mix(0.04, 0.13, fi) * (0.55 + 0.9 * hash12(id + 9.1));
        float soft = mix(0.4, 0.04, fi);
        float flake = smoothstep(size, size * soft, length(f - offset));
        col += flake * mix(0.22, 0.42, fi) * (0.7 + lampGlow * 1.6) * vec3(0.9, 0.94, 1.0);
      }
    }
    outColor = vec4(col * 0.5, clamp(lights, 0.0, 1.0));
  }`;

  // R = fog density, G = latent finger trace, B = water displaced to the margins.
  const FOG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uFog;
  uniform float uAspect, uDt, uTime, uBreath, uTau, uDither;
  uniform int uSegCount;
  uniform vec4 uSeg[${MAX_SEGMENTS}];
  uniform vec2 uSegInfo[${MAX_SEGMENTS}];
  ${NOISE}
  void main() {
    vec4 state = texture(uFog, vUv);
    float fog = state.r;
    float trace = state.g;
    float bank = state.b * exp(-uDt * (0.095 + 0.25 * uBreath));
    vec2 p = vec2(vUv.x * uAspect, 1.0 - vUv.y);
    float target = 1.0 - trace * mix(0.12, 0.5, uBreath);
    float rate = (1.0 + 9.0 * uBreath) / uTau;
    fog += (target - fog) * (1.0 - exp(-uDt * rate));
    trace *= exp(-uDt / 360.0);
    for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
      if (i >= uSegCount) break;
      vec2 a = uSeg[i].xy, b = uSeg[i].zw;
      float r = uSegInfo[i].x;
      vec2 pa = p - a, ba = b - a;
      float len2 = max(dot(ba, ba), 1e-9);
      float h = clamp(dot(pa, ba) / len2, 0.0, 1.0);
      float d = length(pa - ba * h);
      if (d > r * 1.25) continue;
      bool finger = uSegInfo[i].y >= 0.0;
      float strength = abs(uSegInfo[i].y);
      float grain = vnoise(p * 160.0);
      float edge = r * (0.89 + 0.16 * grain);
      float core = 1.0 - smoothstep(edge * 0.74, edge * 1.04, d);
      float wipe = core * strength;
      float across = (ba.x * pa.y - ba.y * pa.x) / (sqrt(len2) * r);
      float streak = finger ? vnoise(vec2(across * 6.0, 0.5)) : 0.0;
      fog = mix(fog, 0.075 * streak * streak, wipe);
      if (finger) trace = max(trace, wipe * 0.95);
      float lip = 1.0 - smoothstep(0.025, finger ? 0.12 : 0.24, abs(d / edge - 0.91));
      float pool = 0.37 + 0.63 * vnoise(p * 36.0 + vec2(3.0, 11.0));
      bank = max(bank * (1.0 - wipe), lip * strength * pool * (0.48 + 0.52 * grain));

    }
    float noise = hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 91.0);
    // Sub-texel recovery would otherwise round away at high refresh rates.
    float quantum = uDither > 0.0 ? 1.0 / 255.0 : 1.0 / 2048.0;
    if (trace < 0.01 && fog < 1.0) fog = floor(fog / quantum + noise) * quantum;
    else fog += (noise - 0.5) * uDither;
    bank = floor(bank / quantum + noise) * quantum;
    outColor = vec4(clamp(fog, 0.0, 1.0), clamp(trace, 0.0, 1.0), bank, 1.0);
  }`;

  // Each atlas cell is a two-unit square. Pin the sliding head at the particle
  // position so stretching the upper part doesn't drag the head off its trail.
  const WATER_VERTEX = `#version 300 es
  layout(location = 0) in vec2 aCorner;
  layout(location = 1) in vec4 aDrop;
  layout(location = 2) in vec3 aShape; // stretch, stable seed, drift
  uniform float uAspect, uGlassHeight;
  out vec2 vAtlas;
  flat out float vFade, vStretch;
  void main() {
    bool sliding = aShape.x > 0.12;
    bool micro = aDrop.z * uGlassHeight < 1.5;
    float tile = sliding ? 12.0 + floor(aShape.y * 6.0) :
                 micro ? 18.0 + floor(aShape.y * 6.0) : floor(aShape.y * 12.0);
    vAtlas = (vec2(mod(tile, 6.0), 3.0 - floor(tile / 6.0)) + 0.5 + aCorner * 0.5) / vec2(6,4);
    vec2 local = aCorner;
    vStretch = sliding ? 0.86 + 0.22 * aShape.x : 1.0;
    if (sliding) {
      local.y += 0.34;
      local.y *= vStretch;
      local.x -= aShape.z * max(local.y, 0.0);
    }
    vec2 pos = aDrop.xy + vec2(local.x, -local.y) * min(aDrop.z * 0.94, (uAspect < 0.9 ? 0.018 : 0.014) * 0.69) / (sliding ? 0.43 : 0.73);
    vec2 vGlass = vec2(pos.x / uAspect, 1.0 - pos.y);
    vFade = aDrop.w;
    gl_Position = vec4(vGlass * 2.0 - 1.0, 0, 1);
  }`;

  // The Blender atlas stores premultiplied slope, cap height and a soft footprint.
  // Overlapping footprints cross the contact threshold together in the composite.
  const WATER_FRAGMENT = `#version 300 es
  precision highp float;
  uniform sampler2D uSurface;
  in vec2 vAtlas;
  flat in float vFade, vStretch;
  out vec4 outColor;
  void main() {
    vec4 field = texture(uSurface, vAtlas);
    field.g = (field.g - 0.5 * field.a) / vStretch + 0.5 * field.a;
    outColor = field * vFade;
  }`;

  const COMPOSITE = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uScene, uFog, uWater, uRoom, uScreen, uCat, uCatFront;
  uniform vec2 uRes, uParallax;
  uniform float uTime, uBreath, uRoomAspect, uHasRoom, uHasCat, uHasFront, uCatAspect, uClockAngleH, uClockAngleM;
  uniform float uTurn, uSillTop, uCatBase, uDebug;
  uniform vec3 uSky;
  uniform vec4 uScreenA, uScreenB; // screen corners in room-image uv (y down): TL, TR | BR, BL
  uniform vec3 uClock;        // centre x, centre y (room uv, y down), radius (fraction of height)
  uniform vec4 uCatRect;      // glass x, glass y of the bottom-left corner, width, height
  uniform vec2 uFrame;        // frame width, sill top
  ${NOISE}

  vec3 sceneAt(vec2 uv, float lod) { return textureLod(uScene, uv, lod).rgb * 2.0; }
  vec3 blurred(vec2 uv, float lod, float spin) {
    vec2 texel = exp2(lod) / vec2(textureSize(uScene, 0));
    vec3 acc = sceneAt(uv, lod) * 2.0;
    for (int i = 0; i < 5; i++) {
      float a = spin + float(i) * 1.2566;
      acc += sceneAt(uv + vec2(cos(a), sin(a)) * texel * 0.9, lod);
    }
    return acc / 7.0;
  }

  float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
  // inverse bilinear map: where p falls inside the quad a-b-c-d (TL, TR, BR, BL)
  vec2 invBilinear(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    vec2 e = b - a, f = d - a, g = a - b + c - d, h = p - a;
    float k2 = cross2(g, f), k1 = cross2(e, f) + cross2(h, g), k0 = cross2(h, e);
    if (abs(k2) < 1e-6) {
      float v = -k0 / k1;
      return vec2((h.x - f.x * v) / (e.x + g.x * v), v);
    }
    float w = k1 * k1 - 4.0 * k0 * k2;
    if (w < 0.0) return vec2(-1.0);
    w = sqrt(w);
    float v = (-k1 - w) * 0.5 / k2;
    float u = (h.x - f.x * v) / (e.x + g.x * v);
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
      v = (-k1 + w) * 0.5 / k2;
      u = (h.x - f.x * v) / (e.x + g.x * v);
    }
    return vec2(u, v);
  }

  // The room behind the viewer, as the glass mirrors it. uv here is screen uv (y up).
  vec3 room(vec2 uv, float lod) {
    float aspect = uRes.x / uRes.y;
    vec2 m = vec2(1.0 - uv.x, uv.y);
    vec2 r = cover(m, aspect, uRoomAspect, 1.08, -uParallax * 0.02);
    vec3 c = uHasRoom > 0.5 ? textureLod(uRoom, r, lod).rgb : vec3(0.02, 0.025, 0.035);
    vec2 rd = vec2(r.x, 1.0 - r.y); // room uv with y down, as the rects are given
    // the monitor shows something live
    if (uHasRoom > 0.5) {
      vec2 sq = invBilinear(rd, uScreenA.xy, uScreenA.zw, uScreenB.xy, uScreenB.zw);
      if (sq.x > 0.0 && sq.x < 1.0 && sq.y > 0.0 && sq.y < 1.0) {
        vec3 s = textureLod(uScreen, vec2(sq.x, 1.0 - sq.y), max(lod - 1.5, 0.0)).rgb;
        float feather = smoothstep(0.0, 0.025, min(min(sq.x, 1.0 - sq.x), min(sq.y, 1.0 - sq.y)));
        c = mix(c, s, feather * 0.9);
      }
      // the wall clock keeps the visitor's time; seen in the mirror it turns the other way
      vec2 cq = (rd - uClock.xy) * vec2(uRoomAspect, 1.0) / uClock.z;
      float cr = length(cq);
      if (cr < 0.97) {
        float face = smoothstep(0.97, 0.9, cr);
        c = mix(c, vec3(0.16, 0.165, 0.175), face);
        float tick = mod(atan(cq.x, -cq.y) / 6.2832 * 12.0 + 0.5, 1.0);
        c += smoothstep(0.08, 0.0, abs(tick - 0.5) - 0.0) * smoothstep(0.7, 0.78, cr) * smoothstep(0.9, 0.86, cr) * 0.1;
        vec2 hdir = vec2(sin(uClockAngleH), -cos(uClockAngleH));
        vec2 mdir = vec2(sin(uClockAngleM), -cos(uClockAngleM));
        float hh = length(cq - hdir * clamp(dot(cq, hdir), 0.0, 0.48));
        float mh = length(cq - mdir * clamp(dot(cq, mdir), 0.0, 0.74));
        c = mix(c, vec3(0.03), (smoothstep(0.05, 0.025, hh) + smoothstep(0.035, 0.015, mh)) * face);
      }
    }
    return c;
  }

  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 g = vec2(vUv.x * aspect, 1.0 - vUv.y);
    float pxg = 1.0 / uRes.y;

    vec4 state = texture(uFog, vUv);
    float fog = clamp(state.r, 0.0, 1.0);
    float trace = state.g;

    vec4 water = texture(uWater, vUv);

    // condensation is made of droplets a few pixels wide
    float cell = worley(gl_FragCoord.xy / 3.0);
    float micro = smoothstep(0.5, 0.05, cell);
    float coarse = fbm(g * 5.0);
    float edgeFog = smoothstep(0.45, 0.95, g.y) * 0.12 + smoothstep(0.35, 0.0, min(g.x, aspect - g.x)) * 0.08;
    float density = fog * clamp(0.8 + 0.2 * coarse + edgeFog, 0.0, 1.0);
    float scatter = density * (0.64 + 0.28 * micro) * (1.0 - 0.5 * trace * fog);

    vec2 refract = (hash22(floor(gl_FragCoord.xy / 3.0)) - 0.5) * 0.006 * fog;
    float spin = hash12(gl_FragCoord.xy) * 6.2832;
    vec3 view = density < 0.04 ? sceneAt(vUv, 0.0) : blurred(vUv + refract, 0.5 + density * 5.2, spin);
    vec3 glow = sceneAt(vUv, 6.5);
    vec3 milk = mix(vec3(dot(glow, vec3(0.3, 0.5, 0.2))), glow, 0.78);
    vec3 haze = vec3(0.3, 0.36, 0.5) * 0.3 + milk * 0.92;
    haze *= 1.0 + 0.16 * uBreath;
    vec3 col = mix(view, haze, clamp(scatter, 0.0, 1.0));
    float lights = textureLod(uScene, vUv, 2.8).a * 0.8 + textureLod(uScene, vUv, 4.3).a * 1.5;
    col += vec3(1.0, 0.88, 0.74) * lights * density * 0.7;

    // wet rim where the finger pushed the water aside
    vec2 ft = 1.0 / vec2(textureSize(uFog, 0));
    float gx = texture(uFog, vUv + vec2(ft.x, 0)).r - texture(uFog, vUv - vec2(ft.x, 0)).r;
    float gy = texture(uFog, vUv + vec2(0, ft.y)).r - texture(uFog, vUv - vec2(0, ft.y)).r;
    vec2 bankSlope = vec2(gx, gy);
    float bankLight = clamp(dot(bankSlope, vec2(-0.44, 0.9)) * 2.8 + 0.47, 0.0, 1.0);
    col = mix(col, col * 0.65 + (milk * 0.94 + vec3(0.073, 0.085, 0.105)) * bankLight, state.b * 0.54);
    col += clamp(length(vec2(gx, gy)) * 0.5, 0.0, 1.0) * (milk * 0.35 + 0.02);

    // the room in the glass: a clear mirror where wiped, a soft sheen with glints where fogged
    vec3 roomSharp = room(vUv, 0.4);
    vec3 roomSoft = room(vUv, 5.0);
    float roomBright = dot(room(vUv, 2.5), vec3(0.33));
    vec3 reflection = mix(roomSharp * 0.1, roomSoft * 0.065 + pow(micro, 5.0) * roomBright * 0.8, density);
    // the darker it is outside, the more of the room the glass shows
    reflection *= 1.0 - 0.8 * uSky.x + 0.35 * uSky.y;
    col += reflection;

    // the cat sits facing the window, so the glass shows its face: mirrored, a little
    // smaller and higher than the cat itself (the eye is above and behind it)
    if (uHasCat > 0.5 && uHasFront > 0.5) {
      float rw = uCatRect.z * 0.8, rh = uCatRect.w * 0.8;
      float rcx = uCatRect.x + uCatRect.z * 0.44 - uParallax.x * 0.012;
      float rby = uCatRect.y - uCatRect.w * 0.5 - uParallax.y * 0.006;
      vec2 rq = vec2(0.5 - (g.x - rcx) / rw, (rby - g.y) / rh);
      if (rq.x > 0.0 && rq.x < 1.0 && rq.y > 0.0 && rq.y < 1.0 && g.y < uFrame.y) {
        vec4 face = textureLod(uCatFront, rq, density * 4.5);
        float strength = mix(0.26, 0.04, density);
        col += face.rgb * face.a * strength * vec3(0.82, 0.88, 1.0);
      }
    }

    // water drops: resolve the shared contact line before tracing the outside view.
    float feather = clamp(fwidth(water.a) * 0.48, 0.025, 0.34);
    float wet = smoothstep(0.40 - feather, 0.40 + feather, water.a);
    if (wet > 0.0) {
      vec3 cap = water.rgb / max(water.a, 0.01);
      vec2 slope = (cap.rg - 0.5) * 2.0;
      vec2 axis = vec2(vUv.x, mix(vUv.y, 0.50, 0.42));
      vec2 lens = axis - slope * vec2(1.0 / aspect, 1.0) * mix(0.29, 0.15, cap.b);
      // The roofline bows toward the contact as the viewing angle changes.
      lens.y += 0.085 * dot(slope, slope);
      vec3 through = sceneAt(lens, 0.0) * 1.14;
      float rim = 1.0 - smoothstep(0.03, 0.22, cap.b);
      vec2 glint = (slope - vec2(-0.28, 0.55)) / vec2(0.39, 0.25);
      float shine = exp(-dot(glint, glint));
      vec3 skylight = sceneAt(vec2(vUv.x, 0.76), 4.0);
      vec3 source = vec3(0.22, 0.24, 0.27) + skylight * 0.40;
      float flank = smoothstep(0.12, 0.95, dot(slope, vec2(0.28, -0.96)));
      float grazing = flank * smoothstep(0.18, 0.76, 1.0 - cap.b);
      float shoulder = smoothstep(0.23, 0.86, length(slope)) * (1.0 - rim);
      vec3 drop = mix(through, source, 0.38 * grazing + 0.16 * shoulder);
      drop *= 1.0 - rim * (0.42 - 0.14 * flank);
      drop += source * (0.70 * shine + 0.30 * sqrt(shine));
      col = mix(col, drop, wet);
    }
    if (uDebug > 0.5) col = mix(col, vec3(1.0,0.0,0.0), wet);

    // the room itself: window frame and sill, lit from outside
    vec3 backlight = glow * 0.9 + 0.03;
    float fw = uFrame.x, sill = uFrame.y;
    float frame = max(max(step(g.x, fw), step(aspect - fw, g.x)), step(g.y, fw));
    vec3 wood = vec3(0.016, 0.021, 0.032);
    float innerEdge = max(max(smoothstep(fw - pxg * 2.0, fw, g.x) * step(g.x, fw),
                              smoothstep(aspect - fw + pxg * 2.0, aspect - fw, g.x) * step(aspect - fw, g.x)),
                          smoothstep(fw - pxg * 2.0, fw, g.y) * step(g.y, fw));
    col = mix(col, wood + innerEdge * backlight * 0.35, frame);
    // the light the whole window lets in: the blurred sky, not whatever happens to be behind a spot
    vec3 windowLight = sceneAt(vec2(0.5, 0.72), 7.5) * 1.15 + 0.02;
    // bottom rail of the window frame, between the glass and the sill
    float rail = 0.011;
    if (g.y > sill - rail && g.y <= sill) {
      float r = (g.y - (sill - rail)) / rail;
      col = wood * 1.2 + windowLight * (0.22 * smoothstep(0.25, 0.0, r) + 0.04);
    }
    if (g.y > sill) {
      // the sill: a pale stone top running from the glass towards the room, then its front edge
      float depth = g.y - sill;
      float top = uSillTop;
      vec3 sillCol;
      if (depth < top) {
        float t = depth / top;
        vec3 stone = vec3(0.62, 0.64, 0.68);
        // lit by the window: brightest against the glass, falling off towards the room
        sillCol = stone * windowLight * mix(0.95, 0.3, pow(t, 0.7));
        // the desk lamp keeps the stone readable even late at night
        sillCol += stone * vec3(0.075, 0.058, 0.042) * (0.55 + 0.45 * t) * (0.5 + 0.5 * (1.0 - vUv.x));
        // a faint warm bounce from the desk lamp on the left, nearer the room
        sillCol += vec3(0.05, 0.034, 0.02) * t * (1.0 - vUv.x);
        // a soft reflection of the view in the polished stone
        sillCol += sceneAt(vec2(vUv.x, 1.0 - sill + depth * 1.4), 3.5) * 0.06 * (1.0 - t);
        // occlusion where the stone meets the frame
        sillCol *= 1.0 - 0.45 * exp(-depth / 0.0025);
        if (uHasCat > 0.5) {
          float cx = uCatRect.x + uCatRect.z * 0.5;
          // the cat mirrored in the stone, foreshortened
          vec2 rq = vec2((g.x - uCatRect.x) / uCatRect.z, (g.y - uCatBase) / (uCatRect.w * 0.35));
          if (rq.x > 0.0 && rq.x < 1.0 && rq.y > 0.0 && rq.y < 1.0) {
            float a = textureLod(uCat, vec2(rq.x, rq.y + 0.004), 2.5).a;
            sillCol *= 1.0 - 0.5 * a * (1.0 - rq.y);
          }
          // contact shadow: tight under the body, soft around it, longer towards the room
          // contact shadow from the cat's own outline: wherever the cat sits just above, the stone is dark
          vec2 catUv = vec2((g.x - uCatRect.x) / uCatRect.z, (uCatRect.y - g.y) / uCatRect.w);
          float under1 = textureLod(uCat, vec2(catUv.x, catUv.y + 0.035), 2.5).a;
          float under2 = textureLod(uCat, vec2(catUv.x, catUv.y + 0.11), 4.0).a;
          float inside = step(0.0, catUv.x) * step(catUv.x, 1.0);
          float shadow = clamp(under1 * 0.8 + under2 * 0.45, 0.0, 0.9) * inside;
          // the window is behind the cat, so its shadow falls forward, towards the room,
          // widening and softening as it goes
          float ahead = max(g.y - uCatBase, 0.0) / top;
          float spread = uCatRect.z * 0.36 * (1.0 + 0.9 * ahead);
          float castShadow = smoothstep(spread, spread * 0.35, abs(g.x - cx)) * exp(-ahead * 1.6) * step(uCatBase - top * 0.05, g.y);
          shadow = max(shadow, castShadow * 0.7);
          sillCol *= 1.0 - clamp(shadow, 0.0, 0.85);
        }
      } else {
        float e = depth - top;
        // bevelled front edge catching the light, then the dark front face
        sillCol = wood * 0.8 + windowLight * (0.28 * exp(-e / 0.0018) + 0.025 * exp(-e / 0.025));
      }
      col = sillCol;
    }

    // the cat, painted in oils, on the sill, its back to us
    if (uHasCat > 0.5) {
      float breathe = 1.0 + 0.007 * sin(uTime * 1.6);
      float squash = 1.0 - 0.07 * sin(3.14159 * uTurn);
      vec2 cq = vec2(((g.x - uCatRect.x) / uCatRect.z - 0.5) / squash + 0.5, (uCatRect.y - g.y) / (uCatRect.w * breathe));
      if (cq.x > 0.0 && cq.x < 1.0 && cq.y > 0.0 && cq.y < 1.0) {
        // A cat with its back to a bright window in a dark room is nearly a silhouette:
        // the painted fur shows only in the dim light bouncing back from the window and the
        // desk lamp, and the window wraps a bright rim around the outline from behind.
        vec4 cat = textureLod(uCat, cq, 0.35);
        float near = textureLod(uCat, cq, 3.5).a;   // alpha blurred a little: how far inside the outline
        float far = textureLod(uCat, cq, 5.5).a;    // blurred a lot
        float lum = dot(cat.rgb, vec3(0.3, 0.55, 0.15));
        vec3 albedo = mix(vec3(lum), cat.rgb, 0.6);
        vec3 catCol = albedo * windowLight * 0.62;                                  // bounce from the window
        catCol += cat.rgb * vec3(0.07, 0.05, 0.032) * smoothstep(0.9, 0.1, cq.x);   // the desk lamp, from the left
        catCol *= mix(0.6, 1.0, smoothstep(0.0, 0.32, cq.y));                       // the sill's shadow
        float wrap = clamp((1.0 - near) * 2.4, 0.0, 1.0);
        float halo = clamp((1.0 - far) * 1.4, 0.0, 1.0);
        float upward = smoothstep(0.18, 0.45, cq.y) * (0.45 + 0.85 * smoothstep(0.45, 0.95, cq.y)); // none where it sits, most on the ears
        catCol += windowLight * (wrap * 0.95 + halo * 0.22) * upward * (0.6 + 0.4 * lum);
        col = mix(col, catCol, cat.a);
        // the window spills a little over the silhouette's edge
        col += windowLight * 0.07 * cat.a * halo * smoothstep(0.2, 0.5, cq.y);
      }
    }

    // restrained, film-like grade
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, 0.9) * vec3(0.95, 0.98, 1.03);
    col = col / (col * 0.27 + 0.85);
    float grain = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5;
    col += grain * (0.045 + 0.03 * (1.0 - clamp(luma, 0.0, 1.0)));
    vec2 vc = (vUv - 0.5) * vec2(aspect, 1.0);
    col *= mix(1.0, 0.72, smoothstep(0.45, 1.25, length(vc)));
    outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

  // ------------------------------------------------------------ GL plumbing

  function compile(vertex, fragment) {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, "");
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
  }

  const programs = {
    scene: compile(VERTEX, SCENE),
    fog: compile(VERTEX, FOG),
    water: compile(WATER_VERTEX, WATER_FRAGMENT),
    composite: compile(VERTEX, COMPOSITE),
  };

  const emptyVao = gl.createVertexArray();
  const waterVao = gl.createVertexArray();
  gl.bindVertexArray(waterVao);
  const cornerBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const instanceData = new Float32Array(MAX_DROPS * 7);
  const instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 28, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);

  function texture2d(options = {}) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(options.fill || [0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function upload(tex, source, mips) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }

  function target(width, height, kind) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const format = kind !== "water" && floatTargets ? gl.RGBA16F : gl.RGBA8;
    const levels = kind === "scene" ? 1 + Math.floor(Math.log2(Math.max(width, height))) : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, kind === "scene" ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { texture: tex, framebuffer, width, height };
  }

  function release(t) {
    if (!t) return;
    gl.deleteTexture(t.texture);
    gl.deleteFramebuffer(t.framebuffer);
  }

  // ------------------------------------------------------------ images

  const images = {
    view: texture2d({ fill: [40, 52, 90, 255] }),
    lights: texture2d(),
    room: texture2d(),
    cat: texture2d(),
    catFront: texture2d(),
    screen: texture2d(),
  };
  const loaded = { view: false, room: false, cat: false, front: false, viewAspect: 16 / 9, roomAspect: 16 / 9, catAspect: 1.5, viewKind: "" };

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  const dropTexture = texture2d();
  let haveDrops = false;
  (async () => {
    const response = await fetch(new URL("./assets/drops-lens.png", import.meta.url));
    if (!response.ok) throw new Error(`Drop atlas HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob(), {
      imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none",
    });
    gl.bindTexture(gl.TEXTURE_2D, dropTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    bitmap.close();
    haveDrops = true;
  })().catch(console.error);

  function loadView() {
    const kind = view.aspect < 0.85 ? "tall" : "wide";
    if (loaded.viewKind === kind) return;
    loaded.viewKind = kind;
    Promise.all([loadImage(`assets/view-${kind}.jpg?v=5`), loadImage(`assets/lights-${kind}.png?v=5`)])
      .then(([photo, lights]) => {
        upload(images.view, photo, false);
        upload(images.lights, lights, true);
        loaded.viewAspect = photo.width / photo.height;
        loaded.view = true;
      })
      .catch(() => {});
  }

  if (options.room)
    loadImage(options.room).then((img) => {
      upload(images.room, img, true);
      loaded.roomAspect = img.width / img.height;
      loaded.room = true;
    }).catch(() => {});
  // the cat: seen from behind, looking out; optionally a matching front view it turns to
  if (options.cat)
    loadImage(options.cat).then((img) => {
      upload(images.cat, img, true);
      loaded.catAspect = img.width / img.height;
      loaded.cat = true;
      layoutCat();
    }).catch(() => {});
  if (options.catFront)
    loadImage(options.catFront).then((img) => {
      upload(images.catFront, img, true);
      loaded.front = true;
    }).catch(() => {});

  // The monitor in the reflection: a loop being written, a loss curve that keeps going down,
  // and a ping that answers the way the owner answers pings.
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 480;
  screenCanvas.height = 300;
  const sctx = screenCanvas.getContext("2d");
  const lossCurve = [];
  let lossValue = 1;
  let screenTimer = 0;
  const codeLines = ["state = observe(world)", "for t in count():", "    state = f(state)", "    if settled(state): break", "", "# same f, every round"];

  function drawScreen() {
    const w = screenCanvas.width, h = screenCanvas.height;
    sctx.fillStyle = "#0b0f17";
    sctx.fillRect(0, 0, w, h);
    sctx.font = "15px ui-monospace, Consolas, monospace";
    sctx.fillStyle = "#8fa3c8";
    codeLines.forEach((line, i) => sctx.fillText(line, 16, 34 + i * 22));
    sctx.fillStyle = "#c9d6ee";
    const now = new Date();
    const stamp = now.toTimeString().slice(0, 8);
    sctx.fillText("$ ping kongtou", 16, 196);
    sctx.fillStyle = "#e8b77a";
    sctx.fillText(`吱  ${stamp}`, 16, 220);
    if (Math.floor(now.getTime() / 600) % 2 === 0) sctx.fillRect(16, 232, 9, 16);
    // loss
    const x0 = 270, y0 = 30, cw = 190, ch = 150;
    sctx.strokeStyle = "#2a3550";
    sctx.lineWidth = 1;
    sctx.strokeRect(x0, y0, cw, ch);
    sctx.strokeStyle = "#9ec3ff";
    sctx.lineWidth = 2;
    sctx.beginPath();
    lossCurve.forEach((v, i) => {
      const x = x0 + (i / 119) * cw, y = y0 + ch - Math.min(1, v) * ch * 0.92;
      i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    });
    sctx.stroke();
    upload(images.screen, screenCanvas, false);
  }

  function stepScreen(dt) {
    screenTimer -= dt;
    if (screenTimer > 0) return;
    screenTimer = 0.5;
    lossValue = lossValue * 0.985 + (Math.random() - 0.5) * 0.02 + 0.002;
    if (lossCurve.length > 119) lossCurve.shift();
    lossCurve.push(Math.max(0.04, lossValue));
    if (lossCurve.length === 120 && lossValue < 0.08) {
      lossCurve.length = 0;
      lossValue = 1;
    }
    drawScreen();
  }
  for (let i = 0; i < 60; i++) {
    lossValue = lossValue * 0.97 + (Math.random() - 0.5) * 0.02 + 0.003;
    lossCurve.push(lossValue);
  }

  // ------------------------------------------------------------ layout

  const view = { width: 1, height: 1, aspect: 1, quality: 1, scene: null, water: null, fog: [null, null], fogIndex: 0 };
  const layout = { frame: 0.018, sill: 0.885, sillTop: 0.042, catBase: 0.9, cat: [0, 0, 0, 0] };

  function layoutCat() {
    const portrait = view.aspect < 0.9;
    layout.catBase = layout.sill + layout.sillTop * 0.62;
    if (loaded.catAspect < 1) {
      // sitting: the painting is cropped so its base sits at the bottom edge
      const height = portrait ? 0.24 : 0.36;
      const width = height * loaded.catAspect;
      const cx = view.aspect * (portrait ? 0.72 : 0.8);
      layout.cat = [cx - width / 2, layout.catBase + height * 0.035, width, height];
    } else {
      const width = portrait ? view.aspect * 0.7 : Math.min(view.aspect * 0.34, 0.62);
      const height = width / loaded.catAspect;
      const x = portrait ? view.aspect * 0.28 : view.aspect * 0.62;
      layout.cat = [x, layout.catBase + height * 0.03, width, height];
    }
  }

  const turn = { value: 0, target: 0, until: 0 };
  function onCat(x, y) {
    const [cx, by, w, h] = layout.cat;
    return loaded.cat && x > cx + w * 0.15 && x < cx + w * 0.85 && y < by && y > by - h * 0.9;
  }

  let glassCssHeight = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * view.quality;
    const rect = canvas.getBoundingClientRect();
    glassCssHeight = Math.max(1, rect.height);
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    if (width === view.width && height === view.height) return;
    canvas.width = width;
    canvas.height = height;
    view.width = width;
    view.height = height;
    view.aspect = width / height;
    release(view.scene);
    view.scene = target(Math.max(2, Math.round(width * 0.5)), Math.max(2, Math.round(height * 0.5)), "scene");
    release(view.water);
    view.water = target(width, height, "water");
    const fogWidth = Math.min(1100, Math.round(width / 2));
    const fogHeight = Math.max(2, Math.round((fogWidth * height) / width));
    for (let i = 0; i < 2; i++) {
      release(view.fog[i]);
      view.fog[i] = target(fogWidth, fogHeight, "fog");
      gl.bindFramebuffer(gl.FRAMEBUFFER, view.fog[i].framebuffer);
      gl.clearColor(1, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    const portrait = view.aspect < 0.9;
    layout.frame = portrait ? 0.012 : 0.018;
    layout.sill = portrait ? 0.9 : 0.885;
    layout.sillTop = portrait ? 0.05 : 0.062;
    layoutCat();
    loadView();
    writer.queue.length = 0;
    writer.active = false;
    drops.length = 0;
    segments.length = 0;
    // Equilibrated fog already contains nuclei of many ages before the first touch.
    for (let i = 0; i < Math.round(64 * view.aspect); i++) {
      const x = layout.frame + random() * (view.aspect - 2 * layout.frame);
      const y = layout.frame + (layout.sill - layout.frame) * random() ** 0.82;
      const d = addDrop(x, y, (0.52 + 0.94 * random() ** 2) / glassCssHeight);
      if (d) d.age = 1;
    }
    schedule.next = clock + 0.5;
  }

  // ------------------------------------------------------------ handwriting

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ellipse(cx, cy, rx, ry, start, sweep, steps = 22) {
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = start + (sweep * i) / steps;
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    });
  }

  const DEG = Math.PI / 180;
  // Letter strokes in letter units: x-height 1, baseline 0, y up.
  const GLYPHS = {
    k: { width: 0.7, strokes: [[[0, 2.05], [0, 0]], [[0.62, 1.0], [0.36, 0.75], [0.08, 0.5], [0.36, 0.26], [0.68, 0]]] },
    o: { width: 0.84, strokes: [ellipse(0.42, 0.5, 0.42, 0.5, 70 * DEG, 372 * DEG)] },
    n: { width: 0.66, strokes: [[[0, 1.02], [0, 0]], [[0, 0.58], [0.1, 0.88], [0.32, 1.0], [0.54, 0.88], [0.62, 0.55], [0.63, 0]]] },
    g: { width: 0.78, strokes: [ellipse(0.37, 0.53, 0.37, 0.47, 25 * DEG, 352 * DEG), [[0.75, 1.02], [0.75, 0.2], [0.73, -0.42], [0.6, -0.76], [0.36, -0.87], [0.12, -0.76]]] },
    t: { width: 0.62, strokes: [[[0.26, 1.62], [0.26, 0.3], [0.31, 0.07], [0.48, 0], [0.62, 0.1]], [[0.0, 1.0], [0.6, 1.03]]] },
    u: { width: 0.66, strokes: [[[0, 1.02], [0, 0.36], [0.07, 0.1], [0.27, 0], [0.48, 0.08], [0.6, 0.34], [0.62, 1.02]], [[0.63, 1.02], [0.63, 0]]] },
    "(": { width: 0.34, strokes: [[[0.3, 1.45], [0.08, 0.95], [0.02, 0.5], [0.08, 0.0], [0.3, -0.45]]] },
    ")": { width: 0.34, strokes: [[[0.03, 1.45], [0.25, 0.95], [0.31, 0.5], [0.25, 0.0], [0.03, -0.45]]] },
  };

  function catmullRom(points, step) {
    if (points.length < 3) {
      const [a, b] = points;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    }
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let j = 1; j <= n; j++) {
        const t = j / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    return out;
  }

  // Each time the name is written it comes out a little different.
  function composeName(seed, withParens) {
    const random = rng(seed);
    const jitter = (s) => (random() - 0.5) * 2 * s;
    const letters = "kongtou";
    const gap = 0.26;
    const wordWidth = [...letters].reduce((w, c) => w + GLYPHS[c].width, 0) + gap * (letters.length - 1);
    const portrait = view.aspect < 0.9;
    // the hesitant "()" adds width; the whole line has to stay inside the frame
    const lineWidth = wordWidth + (withParens ? 0.66 : 0);
    const unit = (Math.min(view.aspect * (portrait ? 0.76 : 0.5), 1.0) / lineWidth) * (0.93 + random() * 0.1);
    const slant = 0.04 + jitter(0.12);
    const radius = Math.min(0.013, Math.max(0.0055, unit * 0.14));
    const room = Math.max(0, view.aspect * (portrait ? 0.88 : 0.8) - lineWidth * unit);
    const left = view.aspect * (portrait ? 0.06 : 0.1) + room * (0.3 + random() * 0.4);
    const baseline = (portrait ? 0.38 : 0.42) + unit * 0.5 + jitter(0.045);
    const tilt = jitter(2.5 * DEG);
    const strokes = [];
    let cursor = 0;
    const place = (glyph, scale, extraBaseline, pauseBefore) => {
      const wobble = jitter(0.07) + extraBaseline;
      const s = scale * (1 + jitter(0.05));
      glyph.strokes.forEach((stroke, index) => {
        const points = stroke.map(([x, y]) => {
          const lx = cursor + x * s + jitter(0.025), ly = y * s + wobble + jitter(0.025);
          const sx = lx + ly * slant, sy = ly;
          const rx = sx * Math.cos(tilt) - sy * Math.sin(tilt), ry = sx * Math.sin(tilt) + sy * Math.cos(tilt);
          return [left + rx * unit, baseline - ry * unit];
        });
        strokes.push({ points: catmullRom(points, unit * 0.045), radius, pause: index === 0 ? pauseBefore : 0.05 + random() * 0.05 });
      });
      cursor += glyph.width * s + gap * (0.85 + random() * 0.3);
    };
    [...letters].forEach((c, i) => place(GLYPHS[c], 1, 0, i === 0 ? 0 : 0.04 + random() * 0.08));
    if (withParens) {
      cursor += 0.12;
      place(GLYPHS["("], 0.8, 0.1, 0.8 + random() * 0.5);
      cursor -= 0.2;
      place(GLYPHS[")"], 0.8, 0.1, 0.12);
    }
    return strokes;
  }

  const writer = { queue: [], active: false, stroke: null, index: 0, wait: 0, speed: 1, last: null };

  function write(seed, withParens) {
    writer.queue = composeName(seed, withParens);
    const length = writer.queue.reduce((sum, s) => sum + s.points.reduce((acc, p, i, a) => (i ? acc + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0), 0);
    writer.speed = length / 2.7;
    writer.active = true;
    writer.stroke = null;
  }

  function stepWriter(dt) {
    if (!writer.active) return;
    let budget = writer.speed * dt;
    while (budget > 0) {
      if (!writer.stroke) {
        writer.stroke = writer.queue.shift();
        if (!writer.stroke) {
          writer.active = false;
          return;
        }
        writer.index = 0;
        writer.wait = writer.stroke.pause;
        writer.last = writer.stroke.points[0];
      }
      if (writer.wait > 0) {
        const use = Math.min(writer.wait, budget / writer.speed);
        writer.wait -= use;
        budget -= use * writer.speed;
        if (writer.wait > 0) return;
        continue;
      }
      const next = writer.stroke.points[writer.index + 1];
      if (!next) {
        releaseCarry();
        writer.stroke = null;
        continue;
      }
      const segment = Math.hypot(next[0] - writer.last[0], next[1] - writer.last[1]);
      if (segment <= budget) {
        wipe(writer.last[0], writer.last[1], next[0], next[1], writer.stroke.radius, 1, true);
        writer.last = next;
        writer.index++;
        budget -= segment;
      } else {
        const t = budget / segment;
        const mid = [writer.last[0] + (next[0] - writer.last[0]) * t, writer.last[1] + (next[1] - writer.last[1]) * t];
        wipe(writer.last[0], writer.last[1], mid[0], mid[1], writer.stroke.radius, 1, true);
        writer.last = mid;
        budget = 0;
      }
    }
  }

  // ------------------------------------------------------------ water

  const segments = [];
  const segData = new Float32Array(MAX_SEGMENTS * 4);
  const segInfo = new Float32Array(MAX_SEGMENTS * 2);
  const drops = [];
  const random = rng(DEBUG_SHOT ? 0x5bd1e995 : Date.now() >>> 0);

  function fingerRadius() {
    return view.aspect < 0.9 ? 0.018 : 0.014;
  }

  function wipe(ax, ay, bx, by, radius, strength, wet) {
    segments.push({ ax, ay, bx, by, radius, strength: wet ? strength : -strength });
    if (!wet) return;
    // the finger smears away the water it passes over and pushes it to the stroke's edges
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    if (length < 1e-8) return;
    const nx = -dy / length, ny = dx / length;
    let swept = 0;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (distanceToSegment(d.x, d.y, ax, ay, bx, by) < radius * 0.63) {
        swept += d.r ** 3;
        drops.splice(i, 1);
      }
    }
    // The finger gathers the condensation it wipes (and any drops it runs into) and carries it
    // along; the water pools where the finger lifts. Only a little leaks to the stroke's edge on
    // the way, mostly on the lower side.
    carry.volume += length * radius * radius * 0.009 + swept;
    carry.x = bx;
    carry.y = by;
    carry.radius = radius;
    swept = 0;
    const patch = noise1((ax + bx) * 18 + (ay + by) * 27);
    let supply = length * (3 + 34 * patch ** 2.6) + random() * 0.6;
    const lowerSide = ny >= 0 ? 1 : -1;
    while (supply >= 1) {
      supply--;
      const t = random(), side = random() < 0.82 ? lowerSide : -lowerSide;
      const lower = ny * side;
      const size = (0.041 + (0.24 + 0.080 * patch) * random() ** 4.1) * (0.88 + 0.24 * lower);
      const r = Math.cbrt((radius * size) ** 3 + swept * 0.85);
      swept = 0;
      const bank = side * radius * (0.74 + 0.28 * random() + 0.15 * patch);
      const x = ax + t * dx + nx * bank, y = ay + t * dy + ny * bank;
      addDrop(x, y, r);
      if (r > radius * 0.15 && random() < patch * 0.55) {
        const offset = r * (1.7 + 2.3 * random());
        const phi = random() * Math.PI * 2;
        addDrop(x + offset * Math.cos(phi), y + offset * Math.sin(phi), r * (0.16 + random() * 0.18));
      }
    }
  }

  // water the finger is carrying; released as one pooled drop where the stroke ends
  const carry = { volume: 0, x: 0, y: 0, radius: 0.014 };
  function releaseCarry() {
    if (carry.volume <= 0) return;
    const r = Math.min(Math.cbrt(carry.volume), carry.radius * 0.75);
    if (r > 0.0012) {
      const d = addDrop(carry.x + (random() - 0.5) * carry.radius * 0.3, carry.y + carry.radius * 0.55, r);
      // it sits a moment, gathering, before it decides to run
      if (d) d.stall = 0.4 + random() * 1.4;
    }
    carry.volume = 0;
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-12)));
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }

  function noise1(x) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const h = (k) => {
      const s = Math.sin(k * 127.1) * 43758.5453;
      return s - Math.floor(s);
    };
    return h(i) + (h(i + 1) - h(i)) * u;
  }

  function addDrop(x, y, r) {
    if (y > layout.sill - r * 0.5 || x < layout.frame || x > view.aspect - layout.frame) return null;
    if (drops.length >= MAX_DROPS) {
      let oldest = -1;
      for (let i = 0; i < drops.length; i++) if (drops[i].speed === 0 && (oldest < 0 || drops[i].age > drops[oldest].age)) oldest = i;
      drops.splice(Math.max(0, oldest), 1);
    }
    const d = { x, y, r, age: 0, alpha: 0, seed: random(), speed: 0, stall: 0.35 + 2.6 * random() ** 2, stretch: 0, travel: 0, pearl: r * (2 + 10 * random() ** 2), drift: 0 };
    drops.push(d);
    return d;
  }

  function merge(into, other) {
    const a = into.r ** 3, b = other.r ** 3;
    into.x = (into.x * a + other.x * b) / (a + b);
    into.y = (into.y * a + other.y * b) / (a + b);
    if (other.speed > into.speed || (other.speed === into.speed && b > a)) {
      into.seed = other.seed;
      into.drift = other.drift;
      into.stall = other.stall;
      into.pearl = other.pearl;
      into.travel = other.travel;
      into.stretch = other.stretch;
    }
    into.trailX = into.x;
    into.trailY = into.y;
    into.r = Math.cbrt(a + b);
    into.alpha = Math.max(into.alpha, other.alpha);
  }

  let condensationClock = 0;

  function stepDrops(dt) {
    const baseCritical = view.aspect < 0.9 ? 0.0066 : 0.0058;
    // the glass keeps collecting beads of condensation, more towards the bottom
    condensationClock += 0; // beads no longer pop out of the fog on their own
    while (condensationClock > 1) {
      condensationClock -= 1;
      const y = layout.frame + (layout.sill - layout.frame) * random() ** 0.8;
      addDrop(layout.frame + random() * (view.aspect - 2 * layout.frame), y, (0.50 + random() * 0.66) / glassCssHeight);
    }
    const deposits = [];
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      d.alpha = Math.min(1, d.age * 3);
      d.r = Math.sqrt(d.r * d.r + dt * (0.000000009 + 0.00000016 * d.seed ** 8));
      const critical = baseCritical * (0.96 + 0.40 * d.seed);
      if (d.r <= critical) {
        d.speed = 0;
        d.stretch *= Math.exp(-dt * 4);
        continue;
      }
      // heavy enough to overcome pinning: stick-slip down the glass
      if (d.stall > 0) {
        d.stall -= dt;
        d.speed *= Math.exp(-dt * 14);
      } else {
        d.speed += ((d.r - critical) * 30 + 0.014 - d.speed) * Math.min(1, dt * 5);
        if (random() < dt * 1.3) d.stall = 0.10 + random() ** 2 * 1.05;
      }
      const x0 = d.x, y0 = d.y;
      const step = d.speed * dt;
      d.y += step;
      // mostly straight down; it only veers a little where the glass pins it
      d.drift = (d.drift || 0) + ((noise1(d.y * 48 + d.seed * 97) - 0.5) * 0.86 - (d.drift || 0)) * Math.min(1, dt * 5);
      d.x += d.drift * step;
      d.stretch += (Math.min(1, d.speed / 0.08) - d.stretch) * Math.min(1, dt * 6);
      const width = d.r * (0.34 + 0.32 * noise1(d.y * 84 + d.seed * 41));
      // Accumulate the swept path in glass space, independently of refresh rate.
      d.trailX ??= x0;
      d.trailY ??= y0;
      if (d.y - d.trailY > width * 0.48) {
        wipe(d.trailX, d.trailY, d.x, d.y, width, 1, false);
        d.trailX = d.x;
        d.trailY = d.y;
      }
      d.travel += step;
      if (d.travel > d.pearl && drops.length + deposits.length < MAX_DROPS) {
        // Pinch-off is local to a pinned patch. Leave long empty reaches between patches.
        const bead = d.r * (0.075 + 0.23 * random() ** 2);
        const strand = random() < 0.28;
        const offset = (random() - 0.5) * width;
        deposits.push([x0 + offset, y0 - d.r * (1.3 + d.stretch), bead, strand]);
        d.r = Math.cbrt(Math.max(d.r ** 3 - bead ** 3, 1e-12));
        d.travel = 0;
        d.pearl = d.r * (random() < 0.33 ? 0.8 + 1.3 * random() : 3.0 + 12.0 * random() ** 1.6);
      }
      if (d.y > layout.sill - d.r * 0.6) drops.splice(i, 1);
    }
    for (const [x, y, r, strand] of deposits) {
      const bead = addDrop(x, y, r);
      if (bead) {
        bead.age = 1;
        bead.thread = strand ? 0.6 + random() : 0;
      }
    }
    // drops within reach of each other coalesce (a coarse grid keeps this cheap)
    const cell = 0.03;
    const grid = new Map();
    drops.forEach((d, i) => {
      const key = Math.floor(d.x / cell) * 4096 + Math.floor(d.y / cell);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(i);
    });
    const dead = new Set();
    drops.forEach((a, i) => {
      if (dead.has(i)) return;
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get((cx + ox) * 4096 + cy + oy);
          if (!list) continue;
          for (const j of list) {
            if (j <= i || dead.has(j)) continue;
            const b = drops[j];
            if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.85) {
              merge(a, b);
              a.speed = Math.max(a.speed, b.speed);
              dead.add(j);
            }
          }
        }
    });
    if (dead.size) {
      const keep = drops.filter((_, i) => !dead.has(i));
      drops.length = 0;
      drops.push(...keep);
    }
  }

  // ------------------------------------------------------------ input

  const pointer = { x: 0.5, y: 0.5, down: false, last: null, moved: 0, at: -99, pressTimer: 0 };
  let breathHeld = false;
  let lastTouch = -99;
  const parallax = [0, 0];
  const parallaxTarget = [0, 0];

  function toGlass(event) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.height, (event.clientY - rect.top) / rect.height];
  }

  canvas.addEventListener("pointerdown", (event) => {
    const [x, y] = toGlass(event);
    if (y > layout.sill || onCat(x, y)) return;
    canvas.setPointerCapture(event.pointerId);
    Object.assign(pointer, { x, y, down: true, last: [x, y], moved: 0, at: clock });
    lastTouch = clock;
    wipe(x, y, x + 0.0005, y, fingerRadius(), 1, true);
    clearTimeout(pointer.pressTimer);
    pointer.pressTimer = setTimeout(() => {
      if (pointer.down && pointer.moved < 0.012) breathHeld = true;
    }, 480);
  });

  canvas.addEventListener("pointermove", (event) => {
    const [x, y] = toGlass(event);
    pointer.x = x;
    pointer.y = y;
    pointer.at = clock;
    if (!pointer.down) return;
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    for (const e of events) {
      const [cx, cy] = toGlass(e);
      pointer.moved += Math.hypot(cx - pointer.last[0], cy - pointer.last[1]);
      if (!breathHeld) wipe(pointer.last[0], pointer.last[1], cx, Math.min(cy, layout.sill), fingerRadius(), 1, true);
      pointer.last = [cx, cy];
    }
    lastTouch = clock;
  });

  const lift = () => {
    if (pointer.down) releaseCarry();
    pointer.down = false;
    breathHeld = false;
    clearTimeout(pointer.pressTimer);
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.repeat && visible && document.activeElement === document.body && scrollY < innerHeight * 0.5) {
      breathHeld = true;
      lastTouch = clock;
      event.preventDefault();
    }
  });
  addEventListener("keyup", (event) => {
    if (event.code === "Space") breathHeld = false;
  });

  // ------------------------------------------------------------ rhythm

  // The sky follows the visitor's own clock (or ?hour=13.5 to preview). Hours are tuned to a
  // northern winter: light by eight, sunset just before five, dark by seven.
  const hourOverride = parseFloat(new URLSearchParams(location.search).get("hour"));
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  function skyState() {
    const now = new Date();
    const h = Number.isFinite(hourOverride) ? hourOverride : now.getHours() + now.getMinutes() / 60;
    const day = smooth(6.8, 8.6, h) * (1 - smooth(15.6, 17.0, h));
    const night = Math.max(smooth(18.0, 19.6, h), 1 - smooth(5.2, 6.6, h));
    const warm = Math.exp(-(((h - 7.3) / 0.6) ** 2)) + Math.exp(-(((h - 16.5) / 0.55) ** 2));
    return [day, night, Math.min(1, warm) * 0.9];
  }

  const schedule = { next: 0.9, cycle: 0, breathAt: 0, breathUntil: -1 };
  let clock = 0;
  const daySeed = Math.floor(Date.now() / 86400000);

  // ?demo: wipe a few strokes shortly after load, so a headless screenshot shows water on the glass
  const demo = new URLSearchParams(location.search).has("demo");
  let demoDone = false;
  function stepDemo() {
    if (!demo || demoDone || clock < 1.2) return;
    demoDone = true;
    const a = view.aspect;
    for (let k = 0; k < 3; k++)
      for (let i = 0; i < 40; i++) {
        const t = i / 40, t2 = (i + 1) / 40, y = 0.3 + k * 0.09;
        wipe(a * 0.08 + t * a * 0.55, y, a * 0.08 + t2 * a * 0.55, y + 0.006, fingerRadius(), 1, true);
      }
      releaseCarry();
  }

  function stepSchedule() {
    stepDemo();
    if (clock - lastTouch < 12) {
      schedule.next = Math.max(schedule.next, clock + 4);
      return;
    }
    if (clock >= schedule.next && !writer.active) {
      const n = schedule.cycle++;
      write(daySeed * 977 + n * 131, n % 2 === 0);
      schedule.next = clock + (reducedMotion ? 60 : 30);
      schedule.breathAt = reducedMotion ? 0 : clock + 25.5;
    }
    if (schedule.breathAt && clock >= schedule.breathAt) {
      schedule.breathUntil = clock + 1.9;
      schedule.breathAt = 0;
    }
  }

  // ------------------------------------------------------------ frame

  let breath = 0;
  let previous = performance.now();
  let slowFrames = 0;
  let visible = true;
  let running = false;

  function wake() {
    if (visible && !document.hidden && !running) {
      previous = performance.now();
      running = true;
      requestAnimationFrame(frame);
    }
  }
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    wake();
  }).observe(canvas);
  // coming back to the tab restarts the loop that stopped while it was hidden
  document.addEventListener("visibilitychange", wake);

  addEventListener("resize", resize);
  resize();

  function frame(now) {
    if (!visible || document.hidden) {
      running = false;
      return;
    }
    const dt = Math.min(DEBUG_SHOT ? 0.5 : 0.05, (now - previous) / 1000);
    previous = now;
    clock += dt;

    if (dt > 0.03) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 40 && view.quality > 0.6) {
      view.quality -= 0.15;
      slowFrames = 0;
      resize();
    }

    stepSchedule();
    stepWriter(dt);
    stepDrops(dt);
    stepScreen(dt);
    const breathing = breathHeld || clock < schedule.breathUntil;
    breath += ((breathing ? 1 : 0) - breath) * Math.min(1, dt * (breathing ? 2.4 : 1.1));
    parallax[0] += (parallaxTarget[0] - parallax[0]) * Math.min(1, dt * 2);
    parallax[1] += (parallaxTarget[1] - parallax[1]) * Math.min(1, dt * 2);

    gl.bindVertexArray(emptyVao);

    // 1. outside
    gl.bindFramebuffer(gl.FRAMEBUFFER, view.scene.framebuffer);
    gl.viewport(0, 0, view.scene.width, view.scene.height);
    const s = programs.scene;
    gl.useProgram(s.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, images.view);
    gl.uniform1i(s.uniforms.uView, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, images.lights);
    gl.uniform1i(s.uniforms.uLights, 1);
    gl.uniform1f(s.uniforms.uTime, reducedMotion ? 7 : clock);
    gl.uniform1f(s.uniforms.uViewAspect, loaded.viewAspect);
    gl.uniform1f(s.uniforms.uHasView, loaded.view ? 1 : 0);
    gl.uniform3f(s.uniforms.uSky, ...skyState());
    gl.uniform2f(s.uniforms.uRes, view.scene.width, view.scene.height);
    gl.uniform2f(s.uniforms.uParallax, parallax[0], parallax[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, view.scene.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 2. condensation
    const src = view.fog[view.fogIndex], dst = view.fog[1 - view.fogIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
    gl.viewport(0, 0, dst.width, dst.height);
    const f = programs.fog;
    gl.useProgram(f.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.texture);
    gl.uniform1i(f.uniforms.uFog, 0);
    gl.uniform1f(f.uniforms.uAspect, view.aspect);
    gl.uniform1f(f.uniforms.uDt, dt);
    gl.uniform1f(f.uniforms.uTime, clock);
    gl.uniform1f(f.uniforms.uBreath, breath);
    gl.uniform1f(f.uniforms.uTau, reducedMotion ? 22 : 11);
    gl.uniform1f(f.uniforms.uDither, floatTargets ? 0 : 1.5 / 255);
    const batch = segments.splice(0, MAX_SEGMENTS);
    batch.forEach((seg, i) => {
      segData.set([seg.ax, seg.ay, seg.bx, seg.by], i * 4);
      segInfo.set([seg.radius, seg.strength], i * 2);
    });
    gl.uniform1i(f.uniforms.uSegCount, batch.length);
    gl.uniform4fv(f.uniforms.uSeg, segData);
    gl.uniform2fv(f.uniforms.uSegInfo, segInfo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    view.fogIndex = 1 - view.fogIndex;

    // 3. water field
    gl.bindFramebuffer(gl.FRAMEBUFFER, view.water.framebuffer);
    gl.viewport(0, 0, view.water.width, view.water.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const count = Math.min(drops.length, MAX_DROPS);
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      instanceData.set([d.x, d.y, d.r, d.alpha, d.thread ? Math.max(d.stretch, d.thread * Math.exp(-d.age / 5)) : d.stretch, d.seed, d.drift * d.stretch], i * 7);
    }
    if (count && haveDrops) {
      const w = programs.water;
      gl.useProgram(w.program);
      gl.uniform1f(w.uniforms.uAspect, view.aspect);
      gl.uniform1f(w.uniforms.uGlassHeight, glassCssHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dropTexture);
      gl.uniform1i(w.uniforms.uSurface, 0);
      gl.bindVertexArray(waterVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, count * 7);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(emptyVao);
    }

    // 4. the window
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    const c = programs.composite;
    gl.useProgram(c.program);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(c.uniforms[name], unit);
    };
    bind(0, view.scene.texture, "uScene");
    bind(1, dst.texture, "uFog");
    bind(2, view.water.texture, "uWater");
    bind(3, images.room, "uRoom");
    bind(4, images.screen, "uScreen");
    bind(5, images.cat, "uCat");
    bind(6, images.catFront, "uCatFront");
    gl.uniform1f(c.uniforms.uHasFront, loaded.front ? 1 : 0);
    gl.uniform1f(c.uniforms.uTurn, turn.value);
    gl.uniform1f(c.uniforms.uSillTop, layout.sillTop);
    gl.uniform1f(c.uniforms.uCatBase, layout.catBase);
    gl.uniform1f(c.uniforms.uDebug, location.search.includes("water") ? 1 : 0);
    gl.uniform3f(c.uniforms.uSky, ...skyState());
    gl.uniform2f(c.uniforms.uRes, view.width, view.height);
    gl.uniform2f(c.uniforms.uParallax, parallax[0], parallax[1]);
    gl.uniform1f(c.uniforms.uTime, clock);
    gl.uniform1f(c.uniforms.uBreath, breath);
    gl.uniform1f(c.uniforms.uRoomAspect, loaded.roomAspect);
    gl.uniform1f(c.uniforms.uHasRoom, loaded.room ? 1 : 0);
    gl.uniform1f(c.uniforms.uHasCat, loaded.cat ? 1 : 0);
    gl.uniform1f(c.uniforms.uCatAspect, loaded.catAspect);
    gl.uniform4f(c.uniforms.uScreenA, ...ROOM.screen.slice(0, 4));
    gl.uniform4f(c.uniforms.uScreenB, ...ROOM.screen.slice(4, 8));
    gl.uniform3f(c.uniforms.uClock, ...ROOM.clock);
    const t = new Date();
    const minutes = t.getMinutes() + t.getSeconds() / 60;
    // mirrored: the hands turn the other way
    gl.uniform1f(c.uniforms.uClockAngleM, -(minutes / 60) * Math.PI * 2);
    gl.uniform1f(c.uniforms.uClockAngleH, -(((t.getHours() % 12) + minutes / 60) / 12) * Math.PI * 2);
    gl.uniform4f(c.uniforms.uCatRect, ...layout.cat);
    gl.uniform2f(c.uniforms.uFrame, layout.frame, layout.sill);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(frame);
  }

  return { write, wipe, drops, view, layout, get clock() { return clock; }, set breathHeld(v) { breathHeld = v; } };
}

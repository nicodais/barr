import * as THREE from 'three';

/**
 * The Suhail Mobile's rally livery, painted at runtime onto one atlas.
 *
 * ## Why it is projected rather than UV-mapped
 *
 * Nothing in vehicleMesh carries UVs — the bodywork is lofted shells and
 * primitives merged per material, and the merge strips every attribute but
 * position and normal. Unwrapping that by hand for one body would mean a second,
 * parallel description of the wagon that has to be kept in step with the first.
 *
 * So the livery is projected instead: the paint shader already carries the
 * body-space position (it needs it for the dust line), and a car is close
 * enough to a box that "which way does this panel face" picks the right
 * drawing. Each flank, the top and the two ends get their own strip of the
 * atlas, drawn here in metres of *body space*, and the shader looks its own
 * position up in whichever strip its normal points at. The corner radii blend
 * between two strips, which is what a wrap does on a real car anyway.
 *
 * The practical upshot is that everything below is laid out against the truck
 * itself: a decal at z = 0.5, y = -0.17 is on the front door, in the same
 * coordinates buildWagon uses, with nothing in between to drift.
 *
 * ## Colour
 *
 * Every blue here is taken off the Suhail mark — the navy of the orb's rim,
 * the royal of its body, the cyan-white of the star at its centre. The livery
 * reads front to back the way the orb reads centre to edge: brightest at the
 * nose, falling away to navy at the tail, with the star's flare drawn out into
 * the stripe down the flank.
 */

const SIZE = 2048;
/** Strip heights in the atlas, top to bottom: left flank, right flank, top, ends. */
const SIDE_H = 576;
const TOP_H = 512;
const END_H = SIZE - SIDE_H * 2 - TOP_H;
const TOP_Y = SIDE_H * 2;
const END_Y = TOP_Y + TOP_H;

/** Body-space extents each strip covers. Padded past the bodywork on purpose,
 *  so a strip's edge never lands on a panel and mip bleed has nowhere to show. */
const HALF_Z = 2.3;
const Y_TOP = 1.18;
const Y_BOTTOM = -0.56;
const HALF_X = 1.0;

const NAVY = '#06186a';
const DEEP = '#0a2a94';
const ROYAL = '#0032aa';
const AZURE = '#0a58e6';
const CYAN = '#5ff0ff';
const ICE = '#d2fbff';
// Knocked down from white for the same reason 'bone' is: a pure white panel
// under a low sun blows out and reads as a hole in the body.
const WHITE = '#eef2f5';

/** How far a slash leans back per metre of height. One number, used by every
 *  angled edge on the car, so they all stay parallel. */
const LEAN = 0.3;
const lean = (z0: number, y: number) => z0 - LEAN * y;

const UNDERSIDE = new THREE.Color(NAVY);

/**
 * GLSL for the paint shader: `suhailLivery(bodyPosition, bodyNormal)`.
 * Generated from the same constants the painter uses so the two cannot disagree
 * about where a strip is.
 */
export const SUHAIL_LIVERY_GLSL = /* glsl */ `
  uniform sampler2D uLivery;
  vec3 liveryTexel(vec2 px) {
    return texture2D(uLivery, vec2(px.x, ${SIZE.toFixed(1)} - px.y) / ${SIZE.toFixed(1)}).rgb;
  }
  vec3 suhailLivery(vec3 p, vec3 n) {
    vec3 w = pow(abs(n), vec3(8.0));
    w /= (w.x + w.y + w.z + 1e-5);
    float sz = clamp((p.z + ${HALF_Z.toFixed(2)}) / ${(HALF_Z * 2).toFixed(2)}, 0.002, 0.998);
    float sy = clamp((${Y_TOP.toFixed(2)} - p.y) / ${(Y_TOP - Y_BOTTOM).toFixed(2)}, 0.006, 0.994);
    float sx = clamp((${HALF_X.toFixed(2)} - p.x) / ${(HALF_X * 2).toFixed(2)}, 0.006, 0.994);
    // Each flank is drawn as it is seen, so lettering reads left to right on
    // both and the nose is at opposite ends of the two strips.
    vec2 side = n.x > 0.0
      ? vec2((1.0 - sz) * ${SIZE.toFixed(1)}, sy * ${SIDE_H.toFixed(1)})
      : vec2(sz * ${SIZE.toFixed(1)}, ${SIDE_H.toFixed(1)} + sy * ${SIDE_H.toFixed(1)});
    vec2 top = vec2(sz * ${SIZE.toFixed(1)}, ${TOP_Y.toFixed(1)} + sx * ${TOP_H.toFixed(1)});
    vec2 end = n.z > 0.0
      ? vec2((1.0 - sx) * ${(SIZE / 2).toFixed(1)}, ${END_Y.toFixed(1)} + sy * ${END_H.toFixed(1)})
      : vec2(${(SIZE / 2).toFixed(1)} + sx * ${(SIZE / 2).toFixed(1)}, ${END_Y.toFixed(1)} + sy * ${END_H.toFixed(1)});
    vec3 c = liveryTexel(side) * w.x + liveryTexel(end) * w.z;
    c += (n.y > 0.0 ? liveryTexel(top) : vec3(${UNDERSIDE.r.toFixed(4)}, ${UNDERSIDE.g.toFixed(4)}, ${UNDERSIDE.b.toFixed(4)})) * w.y;
    return c;
  }
`;

// --- art ----------------------------------------------------------------------

interface Art {
  orb: HTMLImageElement | null;
  dge: HTMLImageElement | null;
  epam: HTMLImageElement | null;
  together: HTMLImageElement | null;
}

const ART_FILES: Record<keyof Art, string> = {
  orb: 'orb.png',
  dge: 'dge.png',
  epam: 'epam.png',
  together: 'evolving-together.png',
};

function loadArt(): Promise<Art> {
  const base = `${import.meta.env.BASE_URL}livery/suhail/`;
  const one = (file: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      // A missing logo costs that logo, not the livery: the painter draws
      // everything else and leaves the space.
      img.onerror = () => resolve(null);
      img.src = base + file;
    });
  const keys = Object.keys(ART_FILES) as (keyof Art)[];
  return Promise.all(keys.map((k) => one(ART_FILES[k]))).then((images) => {
    const art = {} as Art;
    keys.forEach((k, i) => { art[k] = images[i]; });
    return art;
  });
}

// --- panels -------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

/**
 * One strip of the atlas, addressed in body-space metres.
 *
 * `a` runs along the strip and `b` down it; which body axes those are, and
 * which way they run, is the panel's business and nobody else's.
 */
class Panel {
  /** Pixels per metre along each axis. */
  readonly sa: number;
  readonly sb: number;

  constructor(
    readonly ctx: Ctx,
    private x0: number, private y0: number, private w: number, private h: number,
    private a0: number, private a1: number, private b0: number, private b1: number,
  ) {
    this.sa = w / Math.abs(a1 - a0);
    this.sb = h / Math.abs(b1 - b0);
  }

  px(a: number) { return this.x0 + ((a - this.a0) / (this.a1 - this.a0)) * this.w; }
  py(b: number) { return this.y0 + ((b - this.b0) / (this.b1 - this.b0)) * this.h; }

  /** Runs `draw` clipped to this strip, so nothing spills into a neighbour. */
  paint(draw: () => void) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x0, this.y0, this.w, this.h);
    ctx.clip();
    draw();
    ctx.restore();
  }

  fill(style: string | CanvasGradient) {
    this.ctx.fillStyle = style;
    this.ctx.fillRect(this.x0, this.y0, this.w, this.h);
  }

  poly(points: Pt[], style: string | CanvasGradient) {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach(([a, b], i) => {
      if (i === 0) ctx.moveTo(this.px(a), this.py(b));
      else ctx.lineTo(this.px(a), this.py(b));
    });
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }

  /** A gradient running along `a` between two body-space stations. */
  along(from: number, to: number, stops: Array<[number, string]>): CanvasGradient {
    const g = this.ctx.createLinearGradient(this.px(from), 0, this.px(to), 0);
    for (const [at, colour] of stops) g.addColorStop(at, colour);
    return g;
  }

  /** A dot that is round on the car, whatever the strip's two scales are. */
  dot(a: number, b: number, radius: number, style: string) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.ellipse(this.px(a), this.py(b), radius * this.sa, radius * this.sb, 0, 0, Math.PI * 2);
    ctx.fillStyle = style;
    ctx.fill();
  }

  /**
   * Draws upright artwork at a point, in centimetres, y down.
   *
   * Everything that has a right way up — lettering, logos, the door plate —
   * goes through here rather than through `poly`, because the strips are
   * mirrored and stretched relative to one another and a logo must be neither.
   * `turn` is quarter turns clockwise, for the top strip, where "up" is
   * whichever end of the car the thing should be read from.
   */
  decal(a: number, b: number, turn: -1 | 0 | 1, draw: (ctx: Ctx) => void) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(this.px(a), this.py(b));
    if (turn !== 0) {
      ctx.rotate((turn * Math.PI) / 2);
      ctx.scale(this.sb / 100, this.sa / 100);
    } else {
      ctx.scale(this.sa / 100, this.sb / 100);
    }
    draw(ctx);
    ctx.restore();
  }
}

// --- decals (all in centimetres, centred on the origin) --------------------------

const FONT = '"Arial Black", "Helvetica Neue", "Segoe UI", Arial, sans-serif';

function image(ctx: Ctx, img: HTMLImageElement | null, width: number, cx = 0, cy = 0) {
  if (!img) return;
  const height = (width * img.naturalHeight) / img.naturalWidth;
  ctx.drawImage(img, cx - width / 2, cy - height / 2, width, height);
}

/** The four-point star at the heart of the mark, as a soft flare. */
function star(ctx: Ctx, radius: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.22, ICE);
  g.addColorStop(0.55, CYAN);
  g.addColorStop(1, 'rgba(95, 240, 255, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const r = i % 2 === 0 ? radius : radius * 0.13;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The orb. Falls back to a drawn one so the car is never missing its mark. */
function orb(ctx: Ctx, art: Art, diameter: number, cx = 0, cy = 0) {
  if (art.orb) {
    image(ctx, art.orb, diameter, cx, cy);
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  const r = diameter / 2;
  const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
  g.addColorStop(0, AZURE);
  g.addColorStop(0.8, ROYAL);
  g.addColorStop(1, DEEP);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(Math.PI / 4);
  star(ctx, r * 0.7);
  ctx.restore();
}

function label(
  ctx: Ctx, text: string, height: number, colour: string,
  cx = 0, cy = 0, maxWidth?: number, weight = 900,
) {
  ctx.font = `italic ${weight} ${height}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(text, cx, cy, maxWidth);
}

/** A parallelogram leaning the way the slashes lean, centred on the origin. */
function leanedPlate(ctx: Ctx, w: number, h: number, shear: number, colour: string) {
  const s = (shear * h) / 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + s, -h / 2);
  ctx.lineTo(w / 2 + s, -h / 2);
  ctx.lineTo(w / 2 - s, h / 2);
  ctx.lineTo(-w / 2 - s, h / 2);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * The door plate: the one white panel on the car, which is where a rally car
 * puts its number and where a dark-on-light logo can actually be read.
 *
 * @param shear the lean, as seen. The two flanks are mirror images, so the
 *   plate leans the opposite way on each to stay parallel with the slashes.
 */
function doorPlate(ctx: Ctx, art: Art, shear: number) {
  const W = 56;
  const H = 49;
  leanedPlate(ctx, W + 3, H + 3, shear, NAVY);
  leanedPlate(ctx, W, H, shear, WHITE);

  // Header strip, clipped to the plate so its ends pick up the lean.
  ctx.save();
  leanedPlate(ctx, W, H, shear, WHITE);
  ctx.clip();
  ctx.fillStyle = ROYAL;
  ctx.fillRect(-W, -H / 2, W * 2, 8.5);
  ctx.restore();
  label(ctx, 'SUHAIL MOBILE', 5.4, WHITE, shear * 20, -H / 2 + 4.5, W - 10);

  orb(ctx, art, 19, -15 + shear * 6, -6.5);
  label(ctx, '71', 25, DEEP, 10.5 + shear * 6, -5.5);

  image(ctx, art.epam, 32, -shear * 15, 15.5);
}

// --- the drawing ----------------------------------------------------------------

/** Nose-to-tail colour, shared by the flanks and the top so they meet. */
const BODY_STOPS: Array<[number, string]> = [
  [0, AZURE],
  [0.42, ROYAL],
  [0.8, DEEP],
  [1, NAVY],
];

/** Where the dark tail block begins, at y = 0. */
const TAIL_Z = -1.0;
/** The three slashes behind the front door: [z at y=0, width, colour]. */
const SLASHES: Array<[number, number, string]> = [
  [0.03, 0.075, CYAN],
  [-0.065, 0.035, WHITE],
  [-0.125, 0.02, CYAN],
];
/** And the pair on the front wing. */
const WING_SLASHES: Array<[number, number, string]> = [
  [1.2, 0.045, CYAN],
  [1.125, 0.02, WHITE],
];

function paintFlank(p: Panel, art: Art, viewSign: 1 | -1) {
  const yb = Y_BOTTOM - 0.1;
  const yt = Y_TOP + 0.1;
  p.fill(p.along(HALF_Z, -HALF_Z, BODY_STOPS));

  // Tail block, with the navy breaking up into halftone ahead of its edge
  // rather than stopping at a line.
  p.poly([[-HALF_Z - 0.2, yb], [lean(TAIL_Z, yb), yb], [lean(TAIL_Z, yt), yt], [-HALF_Z - 0.2, yt]], NAVY);
  const pitch = 0.058;
  for (let row = 0; row * pitch < yt - yb; row++) {
    const y = yb + row * pitch;
    for (let col = 0; col < 9; col++) {
      const d = 0.03 + (col + (row % 2) * 0.5) * pitch;
      p.dot(lean(TAIL_Z, y) + d, y, 0.027 * (1 - d / 0.56), NAVY);
    }
  }

  // The star's flare, drawn out along the flank: full strength on the wing,
  // gone by the time it reaches the tail block.
  p.poly(
    [[2.25, 0.105], [2.25, 0.2], [lean(TAIL_Z, 0.15) + 0.02, 0.158], [lean(TAIL_Z, 0.15) + 0.02, 0.148]],
    p.along(2.2, lean(TAIL_Z, 0.15), [[0, WHITE], [0.3, ICE], [0.62, CYAN], [1, 'rgba(95, 240, 255, 0.25)']]),
  );
  p.poly(
    [[2.25, 0.062], [2.25, 0.082], [-0.3, 0.076], [-0.3, 0.072]],
    p.along(2.2, -0.3, [[0, CYAN], [1, 'rgba(95, 240, 255, 0)']]),
  );

  for (const [z0, w, colour] of [...SLASHES, ...WING_SLASHES]) {
    p.poly(
      [[lean(z0 - w / 2, yb), yb], [lean(z0 + w / 2, yb), yb], [lean(z0 + w / 2, yt), yt], [lean(z0 - w / 2, yt), yt]],
      colour,
    );
  }

  // A rocker stripe between the arches, the lower edge of the whole scheme.
  p.poly([[0.84, -0.47], [0.86, -0.445], [-0.86, -0.445], [-0.88, -0.47]], CYAN);

  // --- decals ---
  // The lean as seen: the nose is on the left of the left flank and the right
  // of the right, so a rearward lean is a different shear on each.
  const shear = LEAN * viewSign;
  p.decal(0.5, -0.185, 0, (c) => doorPlate(c, art, shear));
  p.decal(-0.5, -0.17, 0, (c) => image(c, art.together, 68));
  p.decal(-1.56, 0.105, 0, (c) => image(c, art.dge, 76));
  // The mark itself on the rear pillar, the one unbroken panel above the waist.
  p.decal(-1.8, 0.6, 0, (c) => {
    c.save();
    c.rotate(Math.PI / 4);
    star(c, 30, 0.5);
    c.restore();
    orb(c, art, 25);
  });
}

function paintTop(p: Panel, art: Art) {
  const xl = HALF_X + 0.1;
  p.fill(p.along(-HALF_Z, HALF_Z, BODY_STOPS.map(([at, c]) => [1 - at, c] as [number, string]).reverse()));

  // The flank graphics carried over the roof at the height they leave it, so
  // each one is a band round the car rather than a sticker on its side.
  const roofY = 1.12;
  const tail = lean(TAIL_Z, roofY);
  p.poly([[-HALF_Z - 0.2, xl], [tail, xl], [tail, -xl], [-HALF_Z - 0.2, -xl]], NAVY);
  const pitch = 0.058;
  for (let row = 0; row * pitch < xl * 2; row++) {
    const x = -xl + row * pitch;
    for (let col = 0; col < 9; col++) {
      const d = 0.03 + (col + (row % 2) * 0.5) * pitch;
      p.dot(tail + d, x, 0.027 * (1 - d / 0.56), NAVY);
    }
  }
  for (const [z0, w, colour] of SLASHES) {
    const z = lean(z0, roofY);
    p.poly([[z - w / 2, xl], [z + w / 2, xl], [z + w / 2, -xl], [z - w / 2, -xl]], colour);
  }

  // Bonnet: the star thrown wide across it, the orb at its centre. Read from
  // the front of the car, as a bonnet is.
  p.decal(1.66, 0, -1, (c) => {
    star(c, 82, 0.55);
    c.save();
    c.rotate(Math.PI / 4);
    star(c, 40, 0.5);
    c.restore();
    orb(c, art, 40);
  });
  p.decal(1.25, 0, -1, (c) => image(c, art.dge, 92));

  // Roof: read from behind, because that is where the chase camera sits.
  p.decal(0.2, 0, 1, (c) => image(c, art.together, 84));
  p.decal(-0.115, 0, 1, (c) => label(c, 'SUHAIL MOBILE', 12.5, WHITE, 0, 0, 104));
  p.decal(-0.8, 0, 1, (c) => {
    orb(c, art, 42, -29, 0);
    label(c, '71', 50, WHITE, 24, 1);
  });
  p.decal(-1.2, 0, 1, (c) => image(c, art.dge, 104));
  p.decal(-1.66, 0, 1, (c) => {
    c.fillStyle = WHITE;
    c.beginPath();
    c.roundRect(-52, -21, 104, 42, 3);
    c.fill();
    image(c, art.epam, 88);
  });
}

function paintFront(front: Panel) {
  front.fill(AZURE);
  // The sun strip across the head of the windscreen.
  front.poly([[-HALF_X, 1.3], [HALF_X, 1.3], [HALF_X, 0.86], [-HALF_X, 0.86]], NAVY);
  front.decal(0, 0.958, 0, (c) => label(c, 'SUHAIL MOBILE', 10, WHITE, 0, 0, 132));
}

function paintRear(rear: Panel, art: Art) {
  rear.fill(NAVY);
  // The cabin's back is glass from the waist up, so the tail's lettering goes
  // on the one painted panel there is: the hull, between the lamp clusters.
  rear.decal(0, 0.105, 0, (c) => {
    orb(c, art, 13, -47, 0);
    label(c, 'SUHAIL MOBILE', 9.5, WHITE, 8, 0.5, 92);
  });
}

function paint(canvas: HTMLCanvasElement, art: Art) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingQuality = 'high';

  const left = new Panel(ctx, 0, 0, SIZE, SIDE_H, HALF_Z, -HALF_Z, Y_TOP, Y_BOTTOM);
  const right = new Panel(ctx, 0, SIDE_H, SIZE, SIDE_H, -HALF_Z, HALF_Z, Y_TOP, Y_BOTTOM);
  const top = new Panel(ctx, 0, TOP_Y, SIZE, TOP_H, -HALF_Z, HALF_Z, HALF_X, -HALF_X);
  const front = new Panel(ctx, 0, END_Y, SIZE / 2, END_H, -HALF_X, HALF_X, Y_TOP, Y_BOTTOM);
  const rear = new Panel(ctx, SIZE / 2, END_Y, SIZE / 2, END_H, HALF_X, -HALF_X, Y_TOP, Y_BOTTOM);

  left.paint(() => paintFlank(left, art, 1));
  right.paint(() => paintFlank(right, art, -1));
  top.paint(() => paintTop(top, art));
  front.paint(() => paintFront(front));
  rear.paint(() => paintRear(rear, art));
}

// --- texture lifetime -------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let artRequested = false;
const live = new Set<THREE.CanvasTexture>();
const NO_ART: Art = { orb: null, dge: null, epam: null, together: null };

/**
 * A texture of the livery for one vehicle view.
 *
 * The canvas is painted once and shared; each view gets its own texture over
 * it so that disposing a view frees its GPU copy, the same way every other
 * buffer in a view is owned (see VehicleView.dispose). The first one is handed
 * back painted but without its logos, which arrive a moment later and are
 * pushed to every texture still alive — a truck that is briefly unbadged beats
 * a vehicle picker that waits on four image requests.
 */
export function acquireSuhailLivery(): THREE.CanvasTexture {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    paint(canvas, NO_ART);
  }
  if (!artRequested) {
    artRequested = true;
    const target = canvas;
    void loadArt().then((art) => {
      paint(target, art);
      for (const texture of live) texture.needsUpdate = true;
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  live.add(texture);
  return texture;
}

export function releaseSuhailLivery(texture: THREE.CanvasTexture) {
  live.delete(texture);
  texture.dispose();
}

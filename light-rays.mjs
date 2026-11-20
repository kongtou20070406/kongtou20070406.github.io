export const observerRadius = 60;
export const horizonRadius = 2;
export const photonSphereRadius = 3;
export const criticalImpact = 3 * Math.sqrt(3);

function acceleration(u) {
  return 3 * u * u - u;
}

// Lengths use GM/c². The state is u = 1/r and slope = du/dφ.
// The ray starts at a static observer, headed inward as φ increases.
export function traceLightRay(impact, step = 0.0125) {
  let u = 1 / observerRadius;
  let slope = Math.sqrt(1 / (impact * impact) - u * u * (1 - 2 * u));
  const inverseRadii = [u];
  const horizon = 1 / horizonRadius;
  const maxSteps = Math.floor(8 * Math.PI / step);

  for (let i = 1; i <= maxSteps; i++) {
    const a = acceleration(u);
    const u2 = u + .5 * step * slope;
    const slope2 = slope + .5 * step * a;
    const u3 = u + .5 * step * slope2;
    const slope3 = slope + .5 * step * acceleration(u2);
    const u4 = u + step * slope3;
    const slope4 = slope + step * acceleration(u3);
    const next = u + step * (slope + 2 * slope2 + 2 * slope3 + slope4) / 6;

    if (next <= 0 || next >= horizon) {
      const boundary = next <= 0 ? 0 : horizon;
      const crossing = (boundary - u) / (next - u);
      return {
        inverseRadii,
        step,
        endAngle: (i - 1 + crossing) * step,
        endInverseRadius: boundary,
        outcome: next <= 0 ? "escaped" : "captured",
      };
    }

    slope += step * (a + 2 * acceleration(u2) + 2 * acceleration(u3) + acceleration(u4)) / 6;
    u = next;
    inverseRadii.push(u);
  }

  return { inverseRadii, step, endAngle: maxSteps * step, endInverseRadius: u, outcome: "unresolved" };
}

export function inverseRadiusAt(ray, angle) {
  if (angle >= ray.endAngle) {
    return ray.endInverseRadius;
  }
  const index = Math.floor(angle / ray.step);
  const start = ray.inverseRadii[index];
  const following = ray.inverseRadii[index + 1];
  const nextAngle = following === undefined ? ray.endAngle : (index + 1) * ray.step;
  const untilNext = (angle - index * ray.step) / (nextAngle - index * ray.step);
  return start + untilNext * ((following ?? ray.endInverseRadius) - start);
}

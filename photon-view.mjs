import { horizonRadius, photonSphereRadius, traceLightRay } from "./light-rays.mjs";

const image = document.querySelector("#black-hole-image");
const canvas = document.querySelector("#photon-canvas");
const toggle = document.querySelector("#ray-toggle");
const controls = document.querySelector("#ray-controls");
const input = document.querySelector("#impact");
const value = document.querySelector("#impact-value");
const result = document.querySelector("#ray-result");
const context = canvas.getContext("2d");

const outcomes = {
  captured: "回溯到事件视界",
  escaped: "偏折后逃向无穷远",
  unresolved: "到达积分上限时仍在绕行",
};

function drawGrid(width, height, spacing) {
  const middleX = width / 2;
  const middleY = height / 2;
  context.beginPath();
  for (let x = middleX % spacing; x < width; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = middleY % spacing; y < height; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.strokeStyle = "#20202c";
  context.lineWidth = 1;
  context.stroke();
}

function drawRay(ray, centerX, centerY, scale) {
  function plotPoint(inverseRadius, angle, first) {
    const radius = scale / inverseRadius;
    const x = centerX - radius * Math.cos(angle);
    const y = centerY - radius * Math.sin(angle);
    if (first) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.beginPath();
  ray.inverseRadii.forEach((u, index) => plotPoint(u, index * ray.step, index === 0));
  if (ray.endInverseRadius > 0) {
    plotPoint(ray.endInverseRadius, ray.endAngle, false);
  }
  context.strokeStyle = "#ffd18a";
  context.lineWidth = 2.2;
  context.shadowColor = "#f2a75680";
  context.shadowBlur = 8;
  context.stroke();
  context.shadowBlur = 0;
}

function render() {
  if (canvas.hidden) {
    return;
  }

  const impact = input.valueAsNumber;
  const ray = traceLightRay(impact);
  value.value = impact.toFixed(2);
  result.textContent = outcomes[ray.outcome];

  const { width, height } = canvas.getBoundingClientRect();
  if (width === 0 || height === 0) {
    return;
  }
  const density = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
  context.setTransform(density, 0, 0, density, 0, 0);

  const centerX = width / 2;
  const centerY = height / 2;
  const scale = Math.min(width / 33, height / 24);
  context.fillStyle = "#0b0b11";
  context.fillRect(0, 0, width, height);
  drawGrid(width, height, 3 * scale);

  context.beginPath();
  context.arc(centerX, centerY, photonSphereRadius * scale, 0, 2 * Math.PI);
  context.strokeStyle = "#a59bbd";
  context.lineWidth = 1.3;
  context.setLineDash([4, 5]);
  context.stroke();
  context.setLineDash([]);

  context.beginPath();
  context.arc(centerX, centerY, horizonRadius * scale, 0, 2 * Math.PI);
  context.fillStyle = "#020203";
  context.strokeStyle = "#837b97";
  context.fill();
  context.stroke();

  drawRay(ray, centerX, centerY, scale);
}

if (context) {
  toggle.hidden = false;
  toggle.addEventListener("click", () => {
    const expanded = controls.hidden;
    controls.hidden = !expanded;
    canvas.hidden = !expanded;
    image.hidden = expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "查看渲染" : "查看光路";
    render();
  });
  input.addEventListener("input", render);
  window.addEventListener("resize", render);
}

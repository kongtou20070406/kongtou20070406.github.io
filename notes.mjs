// notes: a small blog. Posts are Markdown files in posts/, listed in posts/index.json.
// Older notes sit further back in the fog; they clear when the reader comes close.

const DAY = 86400000;
const list = document.getElementById("posts");
const article = document.getElementById("post");
const footLine = document.getElementById("foot-line");
let index = [];

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const dot = (date) => date.replaceAll("-", ".");

function fog(date) {
  const age = Math.max(0, (Date.now() - Date.parse(date)) / DAY);
  return { blur: Math.min(4, Math.max(0, (age - 30) / 90)), fade: Math.max(0.4, 1 - age / 1000) };
}

function inline(s) {
  return escape(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

function markdown(text) {
  const out = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    const lines = block.split("\n");
    if (/^#{1,3} /.test(lines[0])) out.push(`<h2>${inline(lines[0].replace(/^#+ /, ""))}</h2>`);
    else if (lines.every((l) => l.startsWith(">"))) out.push(`<blockquote>${lines.map((l) => inline(l.replace(/^>\s?/, ""))).join("<br>")}</blockquote>`);
    else {
      const caption = lines.length > 1 && /^<small>(.*)<\/small>$/.exec(lines[lines.length - 1]);
      const body = caption ? lines.slice(0, -1) : lines;
      out.push(`<p>${body.map(inline).join("")}</p>`);
      if (caption) out.push(`<small>${escape(caption[1])}</small>`);
    }
  }
  return out.join("\n");
}

function frontMatter(raw) {
  const text = raw.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = Object.fromEntries(m[1].split("\n").map((l) => l.split(/:\s*/, 2)).filter((p) => p.length === 2));
  return { meta, body: text.slice(m[0].length) };
}

function renderList() {
  list.innerHTML = index
    .map((p) => {
      const f = fog(p.date);
      const tags = (p.tags || []).map((t) => `<span class="tag">${escape(t)}</span>`).join("");
      const draft = p.draft ? '<span class="tag draft">draft</span>' : "";
      return `<li style="--fog:${f.blur.toFixed(2)};--fade:${f.fade.toFixed(2)}">
        <a href="#/p/${encodeURIComponent(p.slug)}"><time datetime="${p.date}">${dot(p.date)}</time>
        <h3>${escape(p.title)}${tags}${draft}</h3><p>${escape(p.excerpt || "")}</p></a></li>`;
    })
    .join("");
  const near = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.target.classList.toggle("near", e.isIntersecting)),
    { rootMargin: "-38% 0px -38% 0px" },
  );
  list.querySelectorAll("li").forEach((li) => near.observe(li));
}

async function showPost(slug) {
  const entry = index.find((p) => p.slug === slug);
  if (!entry) return showList();
  const text = await fetch(`posts/${encodeURIComponent(slug)}.md`).then((r) => (r.ok ? r.text() : ""));
  const { meta, body } = frontMatter(text);
  article.innerHTML = `<a class="back" href="#notes">← notes</a>
    <h1>${escape(meta.title || entry.title)}</h1>
    <div class="meta">${dot(meta.date || entry.date)}${entry.draft ? ' · <span class="draft">draft</span>' : ""}</div>
    <div class="body">${markdown(body)}</div>`;
  list.hidden = true;
  document.querySelector(".epigraph").hidden = true;
  article.hidden = false;
  window.scrollTo({ top: document.getElementById("notes").offsetTop, behavior: "instant" });
}

function showList() {
  article.hidden = true;
  list.hidden = false;
  document.querySelector(".epigraph").hidden = false;
}

function route() {
  const m = /^#\/p\/(.+)$/.exec(location.hash);
  if (m) showPost(decodeURIComponent(m[1]));
  else showList();
}

export async function startNotes() {
  try {
    index = await fetch("posts/index.json", { cache: "no-cache" }).then((r) => r.json());
  } catch {
    index = [];
  }
  index.sort((a, b) => b.date.localeCompare(a.date));
  renderList();
  addEventListener("hashchange", route);
  route();
  fetch("posts/footer.txt", { cache: "no-cache" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((t) => (footLine.textContent = t.trim()))
    .catch(() => {});
}

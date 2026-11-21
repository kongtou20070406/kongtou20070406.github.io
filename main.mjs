import { createGlass } from "./glass.mjs";
import { startNotes } from "./notes.mjs";

let glass = null;
try {
  glass = createGlass(document.getElementById("glass"), { room: "assets/room.jpg", cat: "assets/cat-back.webp", catFront: "assets/cat-front.webp" });
} catch (error) {
  console.error(error);
}
if (!glass) document.documentElement.classList.add("offline");
window.__glass = glass;
startNotes();

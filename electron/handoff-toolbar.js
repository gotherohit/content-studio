const available = new URLSearchParams(location.search).get("shortcut") === "true";
const hint = document.getElementById("hint");
document.getElementById("target").textContent = `Using: ${new URLSearchParams(location.search).get("target") || "selected app"}`;
hint.textContent = available ? "Ctrl+Shift+F12 returns even with this toolbar hidden." : "Return shortcut is in use. Use Back to Studio or Alt+Tab.";
document.getElementById("hide").disabled = !available;
document.getElementById("back").onclick = () => window.handoff.back().catch((e) => { hint.textContent = e.message; });
document.getElementById("hide").onclick = () => window.handoff.hide().catch((e) => { hint.textContent = e.message; });

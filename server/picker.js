// A real folder-picker dialog. The browser cannot hand a local path to the server,
// so the server opens the operating system's own dialog and returns what was chosen.
import { spawn } from "node:child_process";

// FolderBrowserDialog is a single-threaded-apartment control, so PowerShell must be
// launched with -STA. Nothing else is needed: an owner window sounds like a way to
// force the dialog to the front, but closing one around a modal child can wedge the
// process, and a bare ShowDialog already comes up in the foreground.
const WINDOWS_PICKER = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'DESCRIPTION_HERE'
$dialog.ShowNewFolderButton = $true
if ('START_HERE'.Length -gt 0 -and (Test-Path -LiteralPath 'START_HERE')) { $dialog.SelectedPath = 'START_HERE' }
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output ('PICKED:' + $dialog.SelectedPath)
} else {
  Write-Output 'CANCELLED'
}
`;

const MAC_PICKER = (desc, start) =>
  `try
  set f to choose folder with prompt "${desc.replace(/"/g, "'")}"${start ? ` default location POSIX file "${start}"` : ""}
  return "PICKED:" & POSIX path of f
on error
  return "CANCELLED"
end try`;

/**
 * Show the OS folder dialog and resolve with the chosen path, or null if dismissed.
 * The dialog appears on the desktop, which is where a local app's dialog belongs.
 */
export function pickFolder({ description = "Choose a folder", startIn = "" } = {}) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (process.platform === "win32") {
      const script = WINDOWS_PICKER
        .replace("DESCRIPTION_HERE", description.replace(/'/g, "''"))
        .replace(/START_HERE/g, startIn.replace(/'/g, "''"));
      // -STA is required: the folder dialog is a single-threaded-apartment control.
      cmd = "powershell.exe";
      args = ["-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script];
    } else if (process.platform === "darwin") {
      cmd = "osascript";
      args = ["-e", MAC_PICKER(description, startIn)];
    } else {
      cmd = "zenity";
      args = ["--file-selection", "--directory", `--title=${description}`, ...(startIn ? [`--filename=${startIn}/`] : [])];
    }

    const child = spawn(cmd, args);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(`Could not open a folder dialog: ${e.message}`)));
    child.on("close", (code) => {
      const text = out.trim();
      if (text.startsWith("PICKED:")) return resolve(text.slice(7).trim());
      if (/CANCELLED/.test(text)) return resolve(null);
      // zenity prints the bare path and exits 1 when dismissed
      if (process.platform !== "win32" && process.platform !== "darwin") {
        return resolve(code === 0 && text ? text : null);
      }
      reject(new Error(err.trim() || "The folder dialog did not return a path"));
    });
  });
}

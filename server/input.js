// Forwards mouse and keyboard events to the desktop so a captured window in the
// Window pane can actually be driven, not just watched. Windows only: one long-lived
// PowerShell process holds the user32 bindings, so each event costs a line of stdin
// rather than a process launch.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BRIDGE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RSIn {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, IntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr p);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public struct POINT { public int X, Y; }
}
"@
function Send-Json($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)) }

function Get-Windows {
  $list = New-Object System.Collections.ArrayList
  $cb = [RSIn+EnumProc]{
    param($h, $p)
    if ([RSIn]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 512
      [void][RSIn]::GetWindowTextW($h, $sb, 512)
      $t = $sb.ToString()
      if ($t.Length -gt 0) {
        $r = New-Object RSIn+RECT
        [void][RSIn]::GetWindowRect($h, [ref]$r)
        $c = New-Object RSIn+RECT
        [void][RSIn]::GetClientRect($h, [ref]$c)
        $o = New-Object RSIn+POINT
        [void][RSIn]::ClientToScreen($h, [ref]$o)
        $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
        if ($w -gt 120 -and $ht -gt 80) {
          [void]$list.Add([pscustomobject]@{
            id = [int64]$h; title = $t
            x = $r.Left; y = $r.Top; w = $w; h = $ht
            cx = $o.X; cy = $o.Y; cw = ($c.Right - $c.Left); ch = ($c.Bottom - $c.Top)
          })
        }
      }
    }
    return $true
  }
  [void][RSIn]::EnumWindows($cb, [IntPtr]::Zero)
  return $list
}

function Get-Screens {
  [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    [pscustomobject]@{ id = $_.DeviceName; title = ("Screen " + $_.DeviceName.Replace('\\.\','') + $(if ($_.Primary) { " (primary)" } else { "" }))
      x = $_.Bounds.X; y = $_.Bounds.Y; w = $_.Bounds.Width; h = $_.Bounds.Height }
  }
}

$MOUSE = @{ 'left_down'=0x0002; 'left_up'=0x0004; 'right_down'=0x0008; 'right_up'=0x0010; 'middle_down'=0x0020; 'middle_up'=0x0040; 'wheel'=0x0800; 'hwheel'=0x1000 }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  try {
    $m = $line | ConvertFrom-Json
    switch ($m.type) {
      'windows' { Send-Json @{ id = $m.id; ok = $true; windows = @(Get-Windows); screens = @(Get-Screens) } }
      'focus'   { [void][RSIn]::ShowWindow([IntPtr]$m.hwnd, 9); [void][RSIn]::SetForegroundWindow([IntPtr]$m.hwnd); Send-Json @{ id = $m.id; ok = $true } }
      'move'    { [void][RSIn]::SetCursorPos([int]$m.x, [int]$m.y); Send-Json @{ id = $m.id; ok = $true } }
      'button'  {
        [void][RSIn]::SetCursorPos([int]$m.x, [int]$m.y)
        $key = "$($m.button)_$($m.action)"
        [RSIn]::mouse_event($MOUSE[$key], 0, 0, 0, [IntPtr]::Zero)
        Send-Json @{ id = $m.id; ok = $true }
      }
      'scroll'  {
        [void][RSIn]::SetCursorPos([int]$m.x, [int]$m.y)
        [RSIn]::mouse_event($MOUSE['wheel'], 0, 0, [int]$m.delta, [IntPtr]::Zero)
        Send-Json @{ id = $m.id; ok = $true }
      }
      'text'    { [System.Windows.Forms.SendKeys]::SendWait($m.text); Send-Json @{ id = $m.id; ok = $true } }
      default   { Send-Json @{ id = $m.id; ok = $false; error = "unknown type" } }
    }
  } catch {
    Send-Json @{ id = $m.id; ok = $false; error = $_.Exception.Message }
  }
}
`;

export function createInput() {
  let child = null;
  let seq = 0;
  const pending = new Map();
  let buf = "";
  let startError = null;

  function ensure() {
    if (process.platform !== "win32") throw new Error("Window control is only implemented on Windows");
    if (startError) throw new Error(startError);
    if (child) return child;
    // The bridge must run from a file: with `-Command -` PowerShell consumes stdin
    // itself, so the script's own read loop would never receive anything.
    const scriptPath = path.join(os.tmpdir(), "research-studio-input.ps1");
    fs.writeFileSync(scriptPath, BRIDGE, "utf8");
    child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        try {
          const msg = JSON.parse(line);
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error || "input failed")); }
        } catch { /* not our line */ }
      }
    });
    child.stderr.on("data", (d) => { startError ??= String(d).slice(0, 300); });
    child.on("exit", () => { child = null; for (const p of pending.values()) p.reject(new Error("input bridge exited")); pending.clear(); });
    return child;
  }

  function send(msg, timeoutMs = 8000) {
    const c = ensure();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("input bridge timed out")); }, timeoutMs);
      pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      c.stdin.write(JSON.stringify({ ...msg, id }) + "\n");
    });
  }

  const stop = () => { try { child?.kill(); } catch { /* already gone */ } child = null; };
  process.on("exit", stop);
  return { send, stop, available: () => process.platform === "win32" };
}

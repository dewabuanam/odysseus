# Draws the Microsoft Store tile and logo images from resources/icon.png into resources/appx/,
# where electron-builder picks them up for the .appx package. Run again after the icon changes.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot
$icon = [Drawing.Image]::FromFile((Join-Path $root 'resources\icon.png'))
$out = Join-Path $root 'resources\appx'
New-Item -ItemType Directory -Force $out | Out-Null

# Name, width, height, and how much of the shorter side the icon fills.
$assets = @(
  @('StoreLogo', 50, 50, 1.0),
  @('Square44x44Logo', 44, 44, 1.0),
  @('SmallTile', 71, 71, 0.75),
  @('Square150x150Logo', 150, 150, 0.66),
  @('Wide310x150Logo', 310, 150, 0.66),
  @('LargeTile', 310, 310, 0.66)
)

try {
  foreach ($a in $assets) {
    $name, $w, $h, $fill = $a
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([Drawing.Color]::Transparent)
      $size = [int][Math]::Round([Math]::Min($w, $h) * $fill)
      $g.DrawImage($icon, [int](($w - $size) / 2), [int](($h - $size) / 2), $size, $size)
    } finally { $g.Dispose() }
    $bmp.Save((Join-Path $out "$name.png"), [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    "$name.png  ${w}x${h}"
  }
} finally { $icon.Dispose() }

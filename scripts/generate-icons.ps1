Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\kenis\.gemini\antigravity\brain\b032c4e2-db25-48b8-8041-97d672874131\.user_uploaded\media_1793643223970_934eb963.jpg"
if (-not (Test-Path $srcPath)) {
    Write-Error "Source icon not found at $srcPath"
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

function Resize-Image($destPath, $width, $height, [System.Drawing.Imaging.ImageFormat]$format) {
    $parent = Split-Path -Parent $destPath
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($srcImg, 0, 0, $width, $height)
    $g.Dispose()

    if (Test-Path $destPath) {
        Remove-Item $destPath -Force
    }
    $bmp.Save($destPath, $format)
    $bmp.Dispose()
    Write-Host "Generated: $destPath ($width x $height)"
}

$png = [System.Drawing.Imaging.ImageFormat]::Png
$jpeg = [System.Drawing.Imaging.ImageFormat]::Jpeg

# Web & PWA
Resize-Image "public\favicon.png" 64 64 $png
Resize-Image "public\icon-192.png" 192 192 $png
Resize-Image "public\icon-512.png" 512 512 $png
Resize-Image "public\pwa-192x192.png" 192 192 $png
Resize-Image "public\pwa-512x512.png" 512 512 $png
Resize-Image "public\apple-touch-icon.png" 180 180 $png
Resize-Image "public\logo.png" 512 512 $png
Resize-Image "public\logo.jpg" 512 512 $jpeg

# Electron Desktop
Resize-Image "electron\icon.png" 512 512 $png

# Android Launcher Mipmaps
$mipmaps = @{
    "mdpi" = 48
    "hdpi" = 72
    "xhdpi" = 96
    "xxhdpi" = 144
    "xxxhdpi" = 192
}

foreach ($density in $mipmaps.Keys) {
    $dim = $mipmaps[$density]
    $folder = "android\app\src\main\res\mipmap-$density"
    Resize-Image "$folder\ic_launcher.png" $dim $dim $png
    Resize-Image "$folder\ic_launcher_round.png" $dim $dim $png
    Resize-Image "$folder\ic_launcher_foreground.png" $dim $dim $png
}

# Android Splash Images
Resize-Image "android\app\src\main\res\drawable\splash.png" 480 480 $png

$splashFolders = Get-ChildItem "android\app\src\main\res" -Directory -Filter "drawable-*"
foreach ($sf in $splashFolders) {
    Resize-Image "$($sf.FullName)\splash.png" 480 480 $png
}

$srcImg.Dispose()
Write-Host "All icons generated successfully!"

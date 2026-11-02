Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\kenis\.gemini\antigravity\brain\b032c4e2-db25-48b8-8041-97d672874131\.user_uploaded\media_1793643223970_934eb963.jpg"
$baseDir = "C:\Users\kenis\OneDrive\Desktop\saatvik\project 1\lumen"

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source image not found: $sourcePath"
    exit 1
}

$sourceImg = [System.Drawing.Image]::FromFile($sourcePath)

function Resize-Image($src, [int]$width, [int]$height, [string]$outPath) {
    $parent = Split-Path $outPath -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $destBmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($destBmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, 0, 0, $width, $height)
    $g.Dispose()

    $destBmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBmp.Dispose()
    Write-Host "Generated: $outPath ($width x $height)"
}

function Save-Ico($src, [string]$outPath) {
    # Generate 256x256 PNG as ICO container
    $parent = Split-Path $outPath -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $sizes = @(16, 32, 48, 64, 128, 256)
    $bmp256 = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp256)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, 0, 0, 256, 256)
    $g.Dispose()

    # Create basic single-image ICO from 256x256 PNG bytes
    $ms = New-Object System.IO.MemoryStream
    $bmp256.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()
    $ms.Dispose()
    $bmp256.Dispose()

    $fs = [System.IO.File]::Create($outPath)
    $bw = New-Object System.IO.BinaryWriter($fs)

    # ICONDIR structure
    $bw.Write([uint16]0) # Reserved
    $bw.Write([uint16]1) # Type (1 = ICO)
    $bw.Write([uint16]1) # Count = 1

    # ICONDIRENTRY structure
    $bw.Write([byte]0)   # Width (0 means 256)
    $bw.Write([byte]0)   # Height (0 means 256)
    $bw.Write([byte]0)   # Color count
    $bw.Write([byte]0)   # Reserved
    $bw.Write([uint16]1) # Color planes
    $bw.Write([uint16]32) # Bits per pixel
    $bw.Write([uint32]$pngBytes.Length) # Image size
    $bw.Write([uint32]22) # Image offset (6 + 16 = 22)

    # Write PNG bytes
    $bw.Write($pngBytes)
    $bw.Flush()
    $fs.Dispose()

    Write-Host "Generated ICO: $outPath"
}

# 1. Android Mipmaps
$resDir = Join-Path $baseDir "android\app\src\main\res"

$androidDensities = @{
    "mipmap-mdpi"    = @{ launcher = 48; foreground = 108 }
    "mipmap-hdpi"    = @{ launcher = 72; foreground = 162 }
    "mipmap-xhdpi"   = @{ launcher = 96; foreground = 216 }
    "mipmap-xxhdpi"  = @{ launcher = 144; foreground = 324 }
    "mipmap-xxxhdpi" = @{ launcher = 192; foreground = 432 }
}

foreach ($density in $androidDensities.Keys) {
    $targetFolder = Join-Path $resDir $density
    $lSize = $androidDensities[$density].launcher
    $fSize = $androidDensities[$density].foreground

    Resize-Image $sourceImg $lSize $lSize (Join-Path $targetFolder "ic_launcher.png")
    Resize-Image $sourceImg $lSize $lSize (Join-Path $targetFolder "ic_launcher_round.png")
    Resize-Image $sourceImg $fSize $fSize (Join-Path $targetFolder "ic_launcher_foreground.png")
}

# 2. Electron / Desktop Icons
$electronDir = Join-Path $baseDir "electron"
Resize-Image $sourceImg 512 512 (Join-Path $electronDir "icon.png")
Save-Ico $sourceImg (Join-Path $electronDir "icon.ico")

# Also copy to root & build-desktop
Resize-Image $sourceImg 512 512 (Join-Path $baseDir "icon.png")
Save-Ico $sourceImg (Join-Path $baseDir "icon.ico")

# 3. Web & PWA Icons
$publicDir = Join-Path $baseDir "public"
Resize-Image $sourceImg 192 192 (Join-Path $publicDir "pwa-192x192.png")
Resize-Image $sourceImg 512 512 (Join-Path $publicDir "pwa-512x512.png")
Resize-Image $sourceImg 180 180 (Join-Path $publicDir "apple-touch-icon.png")
Resize-Image $sourceImg 64 64 (Join-Path $publicDir "favicon.png")
Save-Ico $sourceImg (Join-Path $publicDir "favicon.ico")

$sourceImg.Dispose()
Write-Host "All icons generated successfully!"

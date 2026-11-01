Add-Type -AssemblyName System.Drawing

$baseDir = "C:\Users\kenis\OneDrive\Desktop\saatvik\project 1\lumen"
$resDir = Join-Path $baseDir "android\app\src\main\res"

function Draw-LumenIcon([int]$size, [bool]$isForegroundOnly, [bool]$isRound) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    if ($isForegroundOnly) {
        $g.Clear([System.Drawing.Color]::Transparent)
    } elseif ($isRound) {
        $g.Clear([System.Drawing.Color]::Transparent)
        $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 11, 16))
        $g.FillEllipse($bgBrush, 0, 0, $size, $size)
    } else {
        $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 11, 16))
    }

    $scale = $size / 512.0
    $cx = $size / 2.0
    $cy = $size / 2.0

    # Ambient radial neon glow
    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 0, 240, 255))
    $glowSize = 240.0 * $scale
    $g.FillEllipse($glowBrush, [float]($cx - $glowSize/2.0), [float]($cy - $glowSize/2.0), [float]$glowSize, [float]$glowSize)

    $glowBrushViolet = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 154, 118, 255))
    $g.FillEllipse($glowBrushViolet, [float]($cx - $glowSize*0.35), [float]($cy - $glowSize*0.25), [float]($glowSize*0.8), [float]($glowSize*0.8))

    $cyan = [System.Drawing.Color]::FromArgb(255, 0, 240, 255)
    $violet = [System.Drawing.Color]::FromArgb(255, 154, 118, 255)

    $pt1 = New-Object System.Drawing.PointF([float]($cx - 80*$scale), [float]($cy - 120*$scale))
    $pt2 = New-Object System.Drawing.PointF([float]($cx + 80*$scale), [float]($cy + 120*$scale))
    $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($pt1, $pt2, $cyan, $violet)

    function Draw-Pill([float]$px, [float]$py, [float]$pw, [float]$ph, $pbrush) {
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $radius = $pw / 2.0
        $path.AddArc($px, $py, $pw, $pw, 180, 180)
        $path.AddArc($px, [float]($py + $ph - $pw), $pw, $pw, 0, 180)
        $path.CloseFigure()
        $g.FillPath($pbrush, $path)
    }

    # Vertical bar 1 (Main spine of 'L')
    $b1w = 34.0 * $scale
    $b1h = 220.0 * $scale
    $b1x = $cx - 75.0 * $scale
    $b1y = $cy - 110.0 * $scale
    Draw-Pill $b1x $b1y $b1w $b1h $gradBrush

    # Vertical bar 2 (Middle soundwave frequency)
    $b2w = 28.0 * $scale
    $b2h = 160.0 * $scale
    $b2x = $cx - 28.0 * $scale
    $b2y = $cy - 50.0 * $scale
    Draw-Pill $b2x $b2y $b2w $b2h $gradBrush

    # Vertical bar 3 (Treble soundwave frequency)
    $b3w = 28.0 * $scale
    $b3h = 105.0 * $scale
    $b3x = $cx + 16.0 * $scale
    $b3y = $cy + 5.0 * $scale
    Draw-Pill $b3x $b3y $b3w $b3h $gradBrush

    # Horizontal base beam (completing modern geometric 'L')
    $basePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $baseX = [float]($cx - 75.0 * $scale)
    $baseY = [float]($cy + 80.0 * $scale)
    $baseW = [float](165.0 * $scale)
    $baseH = [float](30.0 * $scale)
    $basePath.AddArc($baseX, $baseY, $baseH, $baseH, 90, 180)
    $basePath.AddArc([float]($baseX + $baseW - $baseH), $baseY, $baseH, $baseH, 270, 180)
    $basePath.CloseFigure()
    $g.FillPath($gradBrush, $basePath)

    # Ambient pulse dot
    $accentBrush = New-Object System.Drawing.SolidBrush($cyan)
    $dotSize = [float](22.0 * $scale)
    $dotX = [float]($cx + 60.0 * $scale)
    $dotY = [float]($cy + 42.0 * $scale)
    $g.FillEllipse($accentBrush, $dotX, $dotY, $dotSize, $dotSize)

    $g.Dispose()
    return $bmp
}

$sizes = @{
    "mipmap-mdpi" = @{ launcher = 48; foreground = 108 };
    "mipmap-hdpi" = @{ launcher = 72; foreground = 162 };
    "mipmap-xhdpi" = @{ launcher = 96; foreground = 216 };
    "mipmap-xxhdpi" = @{ launcher = 144; foreground = 324 };
    "mipmap-xxxhdpi" = @{ launcher = 192; foreground = 432 };
}

foreach ($folder in $sizes.Keys) {
    $dir = Join-Path $resDir $folder
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force }

    $lSize = $sizes[$folder].launcher
    $fgSize = $sizes[$folder].foreground

    # 1. ic_launcher.png (Square/Squircle)
    $imgSquare = Draw-LumenIcon $lSize $false $false
    $imgSquare.Save((Join-Path $dir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $imgSquare.Dispose()

    # 2. ic_launcher_round.png (Round)
    $imgRound = Draw-LumenIcon $lSize $false $true
    $imgRound.Save((Join-Path $dir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $imgRound.Dispose()

    # 3. ic_launcher_foreground.png (Adaptive foreground)
    $imgFg = Draw-LumenIcon $fgSize $true $false
    $imgFg.Save((Join-Path $dir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $imgFg.Dispose()

    Write-Host "Generated $folder icons ($lSize px, $fgSize px)"
}

# Master logo for web
$master = Draw-LumenIcon 512 $false $false
$master.Save((Join-Path $baseDir "public\logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$master.Dispose()

Write-Host "All Minimalist Obsidian & Neon icons generated successfully!"

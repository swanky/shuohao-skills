param(
    [string]$ExternalRoot = 'C:\cc_home\novel-characters-lab\jinpingmei-full',
    [string]$OutputRoot = 'testdata\benchmarks\novel-characters\classic-chinese-novels\金瓶梅-主要角色'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Draw-SourceCrop(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [System.Drawing.Rectangle]$Destination,
    [double]$X,
    [double]$Y,
    [double]$Width,
    [double]$Height
) {
    $source = [System.Drawing.Rectangle]::new(
        [int][Math]::Round($Image.Width * $X),
        [int][Math]::Round($Image.Height * $Y),
        [int][Math]::Round($Image.Width * $Width),
        [int][Math]::Round($Image.Height * $Height)
    )
    $Graphics.DrawImage($Image, $Destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
}

function Draw-Contain(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [System.Drawing.Rectangle]$Bounds
) {
    $scale = [Math]::Min($Bounds.Width / $Image.Width, $Bounds.Height / $Image.Height)
    $width = [int][Math]::Round($Image.Width * $scale)
    $height = [int][Math]::Round($Image.Height * $scale)
    $x = $Bounds.X + [int](($Bounds.Width - $width) / 2)
    $y = $Bounds.Y + [int](($Bounds.Height - $height) / 2)
    $Graphics.DrawImage($Image, [System.Drawing.Rectangle]::new($x, $y, $width, $height))
}

$snapshotPath = Join-Path $ExternalRoot '_current\characters\authority-snapshot.json'
$packagePath = Join-Path $ExternalRoot '_current\characters\CURRENT_PACKAGE.json'
$currentManifestPath = Join-Path $ExternalRoot '_current\characters\manifest.json'
$snapshot = Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json
$package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
$canonicalManifestPath = Join-Path $ExternalRoot $package.canonical_manifest
$outputAbsolute = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputRoot))
$workspaceAbsolute = [System.IO.Path]::GetFullPath((Get-Location).Path)
if (-not $outputAbsolute.StartsWith($workspaceAbsolute, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "輸出路徑不在目前 workspace：$outputAbsolute"
}

$imagesDir = Join-Path $outputAbsolute 'images'
[System.IO.Directory]::CreateDirectory($imagesDir) | Out-Null
$entries = [System.Collections.Generic.List[object]]::new()

foreach ($authority in $snapshot.images) {
    $identityAuthority = if ($null -ne $authority.master) { $authority.master } else { $authority.identity_reference }
    $identityAssetType = if ($null -ne $authority.master) { 'MASTER' } else { 'IDENTITY_REFERENCE' }
    $masterPath = Join-Path $ExternalRoot $identityAuthority.current_path
    $turnaroundPath = Join-Path $ExternalRoot $authority.turnaround.current_path
    if (-not (Test-Path -LiteralPath $masterPath)) { throw "缺少 master：$masterPath" }
    if (-not (Test-Path -LiteralPath $turnaroundPath)) { throw "缺少 turnaround：$turnaroundPath" }
    if ((Get-Sha256 $masterPath) -ne $identityAuthority.sha256) { throw "身份來源雜湊不符：$($authority.character)" }
    if ((Get-Sha256 $turnaroundPath) -ne $authority.turnaround.sha256) { throw "turnaround 雜湊不符：$($authority.character)" }

    $master = [System.Drawing.Image]::FromFile($masterPath)
    $turnaround = [System.Drawing.Image]::FromFile($turnaroundPath)
    try {
        $canvas = [System.Drawing.Bitmap]::new(1672, 941, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [System.Drawing.Graphics]::FromImage($canvas)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

            $leftWidth = 568
            $rightTopHeight = 665
            $cropWidth = 0.60
            $cropHeight = [Math]::Min(0.94, ($master.Width * $cropWidth * 941 / 568) / $master.Height)
            Draw-SourceCrop $graphics $master ([System.Drawing.Rectangle]::new(0, 0, $leftWidth, 941)) 0.20 0.025 $cropWidth $cropHeight
            Draw-Contain $graphics $turnaround ([System.Drawing.Rectangle]::new($leftWidth + 1, 0, 1103, $rightTopHeight - 1))

            $detailBounds = @(
                @{ X = 0.32; Y = 0.05; W = 0.36; H = 0.22 },
                @{ X = 0.22; Y = 0.28; W = 0.56; H = 0.20 },
                @{ X = 0.22; Y = 0.43; W = 0.56; H = 0.18 },
                @{ X = 0.18; Y = 0.80; W = 0.64; H = 0.18 }
            )
            $tileWidth = 266
            for ($index = 0; $index -lt $detailBounds.Count; $index++) {
                $detail = $detailBounds[$index]
                $destination = [System.Drawing.Rectangle]::new($leftWidth + 18 + ($index * 272), $rightTopHeight + 10, $tileWidth, 256)
                Draw-SourceCrop $graphics $master $destination $detail.X $detail.Y $detail.W $detail.H
            }

            $rulePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(180, 185, 185, 185), 1)
            try {
                $graphics.DrawLine($rulePen, $leftWidth, 0, $leftWidth, 941)
                $graphics.DrawLine($rulePen, $leftWidth, $rightTopHeight, 1672, $rightTopHeight)
                for ($index = 1; $index -lt 4; $index++) {
                    $x = $leftWidth + 15 + ($index * 272)
                    $graphics.DrawLine($rulePen, $x, $rightTopHeight + 6, $x, 935)
                }
            } finally {
                $rulePen.Dispose()
            }

            $sheetName = "$($authority.character)-sheet.png"
            $sheetPath = Join-Path $imagesDir $sheetName
            $canvas.Save($sheetPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $canvas.Dispose()
        }
    } finally {
        $master.Dispose()
        $turnaround.Dispose()
    }

    $relativeSheet = "images/$($authority.character)-sheet.png"
    $sheetAbsolute = Join-Path $outputAbsolute ($relativeSheet.Replace('/', '\'))
    $note = if ($authority.character -eq '王婆') {
        '左側身份來源鎖定臉部；右上 turnaround 鎖定體態、衣著與鞋履。'
    } elseif ($authority.character -eq '韓愛姐') {
        '僅以既有完整衣著、非情色 authority bytes 作確定性組合，未生成身體或服裝變體。'
    } else {
        'master 鎖定身份、年齡與主要衣著；turnaround 鎖定正、側、背視圖。'
    }
    $entries.Add([ordered]@{
        canonical_name = $authority.character
        package_id = $package.package_id
        authority_status = $authority.status
        master_or_identity_reference = [ordered]@{
            type = $identityAssetType
            source_path = $identityAuthority.source_path
            current_path = $identityAuthority.current_path
            sha256 = $identityAuthority.sha256
        }
        turnaround = [ordered]@{
            source_path = $authority.turnaround.source_path
            current_path = $authority.turnaround.current_path
            sha256 = $authority.turnaround.sha256
        }
        derived_sheet = [ordered]@{
            path = $relativeSheet
            sha256 = Get-Sha256 $sheetAbsolute
            width = 1672
            height = 941
        }
        transformation = 'DETERMINISTIC_COMPOSITE'
        note = $note
    })
}

$actualCurrentHash = Get-Sha256 $currentManifestPath
$actualCanonicalHash = Get-Sha256 $canonicalManifestPath
$authorityMap = [ordered]@{
    schema_version = '1.0.0'
    external_repo = $ExternalRoot
    package_id = $package.package_id
    package_recorded_canonical_manifest_sha256 = $package.canonical_manifest_sha256
    actual_current_manifest_sha256 = $actualCurrentHash
    actual_canonical_manifest_sha256 = $actualCanonicalHash
    package_manifest_hash_drift = ($package.canonical_manifest_sha256 -ne $actualCanonicalHash)
    authority_snapshot_sha256 = Get-Sha256 $snapshotPath
    authority_projection_sha256 = $snapshot.authority_projection_sha256
    authority_image_count = $snapshot.images.Count * 2
    character_count = $entries.Count
    publish_action = 'NONE'
    transformations = $entries
}
$mapPath = Join-Path $outputAbsolute 'visual-authority-map.json'
$authorityMap | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $mapPath -Encoding utf8
Write-Output ("完成 {0} 張確定性設定圖；映射：{1}" -f $entries.Count, $mapPath)

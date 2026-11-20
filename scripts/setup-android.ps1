# Installs the Android build toolchain without admin rights:
#   JDK 17, Android cmdline-tools, platform-tools, platform 34, build-tools 34, Gradle
#
#   powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
#
# Everything lands in C:\Users\<you>\android-tools. Re-running is safe.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Join-Path $env:USERPROFILE "android-tools"
$Sdk = Join-Path $Root "sdk"
$Log = Join-Path $Root "setup.log"

New-Item -ItemType Directory -Force -Path $Root | Out-Null

function Write-Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $Log -Value $line
}

function Get-File($url, $out) {
    if (Test-Path $out) {
        Write-Log "cached: $(Split-Path $out -Leaf)"
        return
    }
    Write-Log "downloading $(Split-Path $out -Leaf)"
    for ($i = 1; $i -le 3; $i++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 3600
            return
        } catch {
            Write-Log "attempt $i failed: $($_.Exception.Message)"
            Start-Sleep -Seconds 5
        }
    }
    throw "could not download $url"
}

Write-Log "target: $Root"

# 1. JDK 17
$jdkDir = Get-ChildItem $Root -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdkDir) {
    $jdkZip = Join-Path $env:TEMP "dipkri-jdk17.zip"
    Get-File "https://aka.ms/download-jdk/microsoft-jdk-17.0.13-windows-x64.zip" $jdkZip
    Write-Log "extracting JDK"
    Expand-Archive $jdkZip -DestinationPath $Root -Force
    $jdkDir = Get-ChildItem $Root -Directory -Filter "jdk-17*" | Select-Object -First 1
}
$env:JAVA_HOME = $jdkDir.FullName
$env:PATH = "$($jdkDir.FullName)\bin;$env:PATH"
Write-Log "JAVA_HOME=$($jdkDir.FullName)"

# 2. Android cmdline-tools
$sdkManager = Join-Path $Sdk "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkManager)) {
    $cmdZip = Join-Path $env:TEMP "dipkri-cmdtools.zip"
    Get-File "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" $cmdZip
    Write-Log "extracting cmdline-tools"
    $tmp = Join-Path $env:TEMP "dipkri-cmdtools"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $cmdZip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path (Split-Path $sdkManager) | Out-Null
    Move-Item (Join-Path $tmp "cmdline-tools\*") (Split-Path $sdkManager) -Force
}

# 3. SDK packages (licenses accepted non-interactively)
Write-Log "installing SDK packages"
$yes = ("y`n" * 60)
$yes | & $sdkManager --sdk_root=$Sdk "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 |
    Select-Object -Last 6 | ForEach-Object { Write-Log $_ }

# 4. Gradle
$gradleBin = Join-Path $Root "gradle\bin\gradle.bat"
if (-not (Test-Path $gradleBin)) {
    $gradleZip = Join-Path $env:TEMP "dipkri-gradle.zip"
    Get-File "https://services.gradle.org/distributions/gradle-8.7-bin.zip" $gradleZip
    Write-Log "extracting Gradle"
    Expand-Archive $gradleZip -DestinationPath $Root -Force
    $gradleDir = Get-ChildItem $Root -Directory -Filter "gradle-8.*" | Select-Object -First 1
    if ($gradleDir.FullName -ne (Join-Path $Root "gradle")) {
        Move-Item $gradleDir.FullName (Join-Path $Root "gradle") -Force
    }
}

Write-Log "done"
Write-Log "JAVA_HOME=$env:JAVA_HOME"
Write-Log "ANDROID_HOME=$Sdk"
Write-Log "build: cd android; ..\android-tools\gradle\bin\gradle.bat assembleDebug"

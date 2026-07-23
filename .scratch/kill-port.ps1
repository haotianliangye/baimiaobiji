Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("killing pid=" + $_.OwningProcess)
  Stop-Process -Id $_.OwningProcess -Force
}
Start-Sleep -Seconds 1
$remaining = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Output ("remaining_listeners=" + $remaining)
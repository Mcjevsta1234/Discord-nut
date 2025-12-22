# Test script for Emma persona with Minecraft network status
Write-Host "Testing Emma Persona with Minecraft Network Status" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

$testInput = @"
/persona emma
hey emma, could you check the minecraft network status?
what servers are online?
tell me about the witchyworlds minecraft servers
/exit
"@

Write-Host "`nTest Input:" -ForegroundColor Yellow
Write-Host $testInput -ForegroundColor Gray

Write-Host "`n`nStarting Console Chat..." -ForegroundColor Yellow
Write-Host "=" * 60 -ForegroundColor Cyan

$testInput | npm run console

Write-Host "`n`nTest Complete!" -ForegroundColor Green

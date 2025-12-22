# Console Mode Test Script

Write-Host "Testing Console Mode..." -ForegroundColor Cyan

# Create a test input file
$testInput = @"
/help
/personas
hello bot
/exit
"@

$testInput | Out-File -FilePath "test_input.txt" -Encoding UTF8

Write-Host "`nRunning console mode with test input..." -ForegroundColor Yellow
Get-Content "test_input.txt" | npm run console

# Clean up
Remove-Item "test_input.txt" -ErrorAction SilentlyContinue

Write-Host "`nTest complete!" -ForegroundColor Green

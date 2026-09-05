# Cloudflare Tunnel setup for IPO Board
# ----------------------------------------------------------------
# Prerequisites:
#   1. `cloudflared` installed  -> https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
#   2. Logged in:  cloudflared tunnel login
#
# Usage (PowerShell, from the repo root):
#   1. .\.cloudflared\setup.ps1  -TunnelName ipoboard
#      -> prints a <TUNNEL-UUID> and writes a CNAME record command below.
#   2. In the Cloudflare dashboard add the DNS CNAME as instructed.
#   3. Start the tunnel:
#      cloudflared tunnel run ipoboard
#      (or:  cloudflared tunnel --config .cloudflared\config.yml run ipoboard)
param(
  [string]$TunnelName = "ipoboard"
)

Write-Host "1) Creating tunnel '$TunnelName' ..." -ForegroundColor Cyan
cloudflared tunnel create $TunnelName

Write-Host ""
Write-Host "2) Copy the generated <TUNNEL-UUID> above, then edit ".cloudflared\config.yml":" -ForegroundColor Cyan
Write-Host "   - tunnel: <YOUR-TUNNEL-UUID>"
Write-Host "   - credentials-file path"
Write-Host "   - hostname -> your public subdomain (e.g. ipoboard.example.com)"
Write-Host ""
Write-Host "3) Create the DNS route in the dashboard (or run the command it gives you):" -ForegroundColor Cyan
Write-Host "   cloudflared tunnel route dns $TunnelName <subdomain>"
Write-Host ""
Write-Host "4) To protect /admin/sync with Access, in Cloudflare Zero Trust create an" -ForegroundColor Cyan
Write-Host "   Access application for the subdomain and apply a rule to path /admin/sync."

@echo off
setlocal
cd /d "%~dp0"
title OrdaX - Gravar pendrive fisico
echo.
echo O Windows solicitara permissao de Administrador.
echo A gravacao somente sera liberada em um pacote fisico canonicamente
echo autorizado e ainda exigira a confirmacao exata do pendrive escolhido.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp03-Write-OrdaXUSB.ps1"
if errorlevel 1 (
  echo.
  echo GRAVACAO_ORDAX=FALHOU_OU_FOI_CANCELADA
  pause
  exit /b 1
)
endlocal

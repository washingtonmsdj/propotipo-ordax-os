@echo off
setlocal
cd /d "%~dp0"
title OrdaX - Assinar primeira release
echo.
echo Esta etapa NAO copia a chave privada para o pacote.
echo Ela gera somente release-envelope.json a partir do manifesto verificado.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp04-Sign-Initial-OrdaXRelease.ps1"
if errorlevel 1 (
  echo.
  echo ASSINATURA_INICIAL=FALHOU
  pause
  exit /b 1
)
echo.
echo ASSINATURA_INICIAL=CONCLUIDA
echo O arquivo release-envelope.json pode ser publicado junto com system.tar.
echo A chave privada NAO deve ser publicada.
echo.
pause
endlocal

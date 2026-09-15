@echo off
setlocal
cd /d "%~dp0"
title OrdaX - Inspecao segura do pendrive
echo.
echo ============================================================
echo   OrdaX - Inspecao segura do pendrive
echo ============================================================
echo.
echo Esta etapa NAO grava, formata ou altera nenhum disco.
echo.
"%~dp0ordax-creator-physical-test.exe" status
if errorlevel 1 goto :error
echo.
echo Pendrives USB elegiveis detectados:
echo.
"%~dp0ordax-creator-physical-test.exe" targets
if errorlevel 1 goto :error
echo.
echo INSPECAO_USB=CONCLUIDA
echo Copie apenas a saida desta janela se precisar continuar a analise.
echo Nunca envie arquivos .pem ou chaves privadas.
goto :end

:error
echo.
echo INSPECAO_USB=FALHOU
echo Nenhuma escrita fisica foi autorizada por este script.

:end
echo.
pause
endlocal

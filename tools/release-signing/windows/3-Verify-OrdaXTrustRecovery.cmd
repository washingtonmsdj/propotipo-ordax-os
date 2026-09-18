@echo off
setlocal
cd /d "%~dp0"
title OrdaX - Verificar recuperacao da chave de release
echo.
echo ============================================================
echo   OrdaX - Verificar recuperacao da chave de release
echo ============================================================
echo.
echo Esta etapa exige uma copia da chave privada que tenha sido
echo RECUPERADA a partir do backup offline criptografado.
echo.
echo A chave recuperada nao sera enviada ao Git, ao ChatGPT,
echo ao pendrive OrdaX ou a artefatos do GitHub Actions.
echo.
set /p "RECOVERED_KEY=Informe o caminho completo da chave PEM recuperada: "
if "%RECOVERED_KEY%"=="" goto :error

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Complete-OrdaXReleaseTrust.ps1" -RecoveredPrivateKeyPath "%RECOVERED_KEY%"
if errorlevel 1 goto :error

echo.
echo RECUPERACAO_OFFLINE=VERIFICADA
echo Somente a chave publica e a evidencia nao secreta foram preparadas.
goto :end

:error
echo.
echo RECUPERACAO_OFFLINE=FALHOU
echo A ancora publica continua bloqueada e nenhuma autorizacao fisica foi concedida.

:end
echo.
pause
endlocal

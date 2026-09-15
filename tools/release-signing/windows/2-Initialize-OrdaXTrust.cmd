@echo off
setlocal
cd /d "%~dp0"
title OrdaX - Inicializar confianca de release
echo.
echo ============================================================
echo   OrdaX - Inicializar confianca de release
echo ============================================================
echo.
echo A chave privada sera criada FORA desta pasta, no armazenamento
echo privado local do seu usuario. Ela NAO deve ser enviada ao Git,
echo ao ChatGPT, ao pendrive OrdaX ou a artefatos do GitHub Actions.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Initialize-OrdaXReleaseTrust.ps1"
if errorlevel 1 goto :error
echo.
echo CERIMONIA_LOCAL=CONCLUIDA
echo Antes de fixar a chave publica no Git, crie e verifique pelo menos
echo uma copia de recuperacao OFFLINE E CRIPTOGRAFADA da chave privada.
goto :end

:error
echo.
echo CERIMONIA_LOCAL=FALHOU
echo Nenhuma autorizacao de escrita fisica foi concedida.

:end
echo.
pause
endlocal

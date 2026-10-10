@echo off
rem Undo "Associate .fountain files.cmd".
reg delete "HKCU\Software\Classes\Dynamo.Fountain" /f >nul 2>&1
reg delete "HKCU\Software\Classes\.fountain\OpenWithProgids" /v "Dynamo.Fountain" /f >nul 2>&1
reg delete "HKCU\Software\Classes\.spmd\OpenWithProgids" /v "Dynamo.Fountain" /f >nul 2>&1
for /f "tokens=3" %%v in ('reg query "HKCU\Software\Classes\.fountain" /ve 2^>nul') do if "%%v"=="Dynamo.Fountain" reg delete "HKCU\Software\Classes\.fountain" /ve /f >nul 2>&1
ie4uinit.exe -show >nul 2>&1
echo Dynamo .fountain association removed.
pause

@echo off
rem Optional: make Dynamo open .fountain files. Per-user (HKCU), no admin, fully undoable.
rem Keep this file next to Dynamo.exe. Undo with "Remove .fountain association.cmd".
set "EXE=%~dp0Dynamo.exe"
if not exist "%EXE%" (echo Dynamo.exe not found next to this script. & pause & exit /b 1)

reg add "HKCU\Software\Classes\.fountain" /ve /d "Dynamo.Fountain" /f >nul
reg add "HKCU\Software\Classes\.fountain\OpenWithProgids" /v "Dynamo.Fountain" /t REG_NONE /f >nul
reg add "HKCU\Software\Classes\.spmd\OpenWithProgids" /v "Dynamo.Fountain" /t REG_NONE /f >nul
reg add "HKCU\Software\Classes\Dynamo.Fountain" /ve /d "Fountain Screenplay" /f >nul
reg add "HKCU\Software\Classes\Dynamo.Fountain\DefaultIcon" /ve /d "\"%~dp0Dynamo.ico\"" /f >nul
reg add "HKCU\Software\Classes\Dynamo.Fountain\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
ie4uinit.exe -show >nul 2>&1

echo .fountain files now open in Dynamo.
echo If Windows still asks, right-click a .fountain file ^> Open with ^> Dynamo ^> Always.
pause

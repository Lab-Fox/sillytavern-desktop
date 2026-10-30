; Custom NSIS steps for the installer build (package.json → build.nsis.include).
;
; electron-builder closes a running app by killing its processes, so the app
; never gets to stop the SillyTavern server or save its log. Ask it to quit
; first (`--quit` reaches the running copy as a second instance); the usual
; kill is still there for anything left over.

; electron-builder only includes these itself when there is no custom check.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ; Self-update runs the installer silently after the app already quit.
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} is running.$\r$\nClick OK to close it. The SillyTavern server is stopped first." /SD IDOK IDOK stQuitApp
      Quit
    ${endIf}
    stQuitApp:
    Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit`
    StrCpy $R1 0
    stWaitQuit:
      Sleep 500
      IntOp $R1 $R1 + 1
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
      ${andIf} $R1 < 30
        Goto stWaitQuit
      ${endIf}
  ${endIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend

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

; "Open with → SillyTavern Desktop" for character cards, lorebooks and
; presets. Only an Open-with entry (OpenWithProgids): the app never becomes
; the default for .png or .json, and Windows' own choice stays as it was.
!define ST_IMPORT_PROGID "SillyTavernDesktop.Import"
!macro stOpenWith EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${ST_IMPORT_PROGID}" ""
!macroend
!macro stNoOpenWith EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${ST_IMPORT_PROGID}"
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\${ST_IMPORT_PROGID}" "" "SillyTavern import"
  WriteRegStr SHCTX "Software\Classes\${ST_IMPORT_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${ST_IMPORT_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro stOpenWith ".png"
  !insertmacro stOpenWith ".json"
  !insertmacro stOpenWith ".charx"
  !insertmacro stOpenWith ".byaf"
  !insertmacro stOpenWith ".yaml"
  !insertmacro stOpenWith ".yml"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro stNoOpenWith ".png"
  !insertmacro stNoOpenWith ".json"
  !insertmacro stNoOpenWith ".charx"
  !insertmacro stNoOpenWith ".byaf"
  !insertmacro stNoOpenWith ".yaml"
  !insertmacro stNoOpenWith ".yml"
  DeleteRegKey SHCTX "Software\Classes\${ST_IMPORT_PROGID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

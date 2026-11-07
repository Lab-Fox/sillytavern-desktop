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

; ---------- where it goes ----------
; Always for this user only: never the "all users" page, never an admin
; prompt (SillyTavern asks not to run as administrator). People choose the
; folder; a fresh install suggests the fixed drive with the most free space
; that isn't the Windows drive. The app keeps its data in "SillyTavern Desktop
; Data" next to the install folder (updates wipe the install folder itself).
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where SillyTavern Desktop goes. Its data is kept next to this folder. A drive other than the Windows drive keeps both safe if Windows is ever reinstalled. Windows' own folders (Program Files, Windows, ProgramData) can't be used."

!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  Var stBestDrive
  Var stBestFree
  Function stDriveFound
    ; $9 = "D:\"; skip the Windows drive.
    StrCpy $R5 $WINDIR 3
    ${if} $9 != $R5
      ${DriveSpace} "$9" "/D=F /S=M" $R4
      ${if} $R4 > $stBestFree
      ${andIf} $R4 >= 5120
        StrCpy $stBestFree $R4
        StrCpy $stBestDrive $9
      ${endIf}
    ${endIf}
    Push $0
  FunctionEnd

  ; Is $INSTDIR in (or equal to) a folder Windows controls? Leaves 1 or 0 in $R0.
  !macro stUnder ROOT
    ${if} "${ROOT}" != ""
      StrLen $R1 "${ROOT}"
      StrCpy $R2 $INSTDIR $R1
      StrCpy $R3 $INSTDIR 1 $R1
      ${if} $R2 == "${ROOT}"
      ${andIf} $R3 == ""
        StrCpy $R0 1
      ${elseIf} $R2 == "${ROOT}"
      ${andIf} $R3 == "\"
        StrCpy $R0 1
      ${endIf}
    ${endIf}
  !macroend
  Function .onVerifyInstDir
    StrCpy $R0 0
    !insertmacro stUnder $WINDIR
    !insertmacro stUnder $PROGRAMFILES32
    !insertmacro stUnder $PROGRAMFILES64
    ReadEnvStr $R6 "ProgramData"
    !insertmacro stUnder $R6
    ${if} $R0 == 1
      Abort
    ${endIf}
  FunctionEnd
!endif

!macro customInstallMode
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "1"
  !insertmacro setInstallModePerUser
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $R9 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    !insertmacro GetDParameter $R8
    ${if} $R9 == ""
    ${andIf} $R8 == ""
      StrCpy $stBestDrive ""
      StrCpy $stBestFree 0
      ${GetDrives} "HDD" "stDriveFound"
      ${if} $stBestDrive != ""
        StrCpy $R7 $stBestDrive
        StrCpy $INSTDIR "$R7SillyTavern Desktop"
      ${endIf}
    ${endIf}
  !endif
  Abort
!macroend

; "Open with → SillyTavern Desktop" for character cards, lorebooks and
; presets. Only an Open-with entry (OpenWithProgids): the app never becomes
; the default for .png or .json, and Windows' own choice stays as it was.
; Named after the app id, so a test build with its own id leaves the real one alone.
!define ST_IMPORT_PROGID "${APP_ID}.Import"
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
  !insertmacro stOpenWith ".sttheme"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro stNoOpenWith ".png"
  !insertmacro stNoOpenWith ".json"
  !insertmacro stNoOpenWith ".charx"
  !insertmacro stNoOpenWith ".byaf"
  !insertmacro stNoOpenWith ".yaml"
  !insertmacro stNoOpenWith ".yml"
  !insertmacro stNoOpenWith ".sttheme"
  DeleteRegKey SHCTX "Software\Classes\${ST_IMPORT_PROGID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

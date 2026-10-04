; Odysseus needs Git 2.36+. Before installing, check for it and, when it's missing or too
; old, install the latest Git for Windows alongside the app. Setup doesn't continue without it.

!macro customInit
  ${IfNot} ${UAC_IsInnerInstance}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\ensure-git.ps1" "${PROJECT_DIR}\installer\ensure-git.ps1"
    StrCpy $R9 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ensure-git.ps1"'

    nsExec::ExecToStack '$R9 -Check'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      ${IfNot} ${Silent}
        MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Odysseus needs Git 2.36 or newer, and it isn't installed on this computer.$\r$\n$\r$\nSetup will download Git for Windows from github.com and install it first. Windows will ask for permission to install Git." IDOK odysseus_install_git
        Abort
      ${EndIf}

      odysseus_install_git:
      Banner::show /set 76 "Installing Git for Windows" "Downloading and installing Git. This can take a minute."
      nsExec::ExecToStack '$R9 -Install'
      Pop $0
      Pop $1
      Banner::destroy
      ${If} $0 != "0"
        ${If} ${Silent}
          Abort
        ${EndIf}
        MessageBox MB_RETRYCANCEL|MB_ICONSTOP "Git for Windows could not be installed:$\r$\n$1$\r$\nInstall it from https://git-scm.com/download/win and run this setup again, or retry now." IDRETRY odysseus_install_git
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; AI command-line tools for the AI pane: Claude Code (the default), Codex, Gemini and Copilot.
; Installed per user after the app, only the ones that are missing. Never blocks setup.
; Then the app writes its skills into each tool's skills folder.
!macro customInstall
  ${IfNot} ${UAC_IsInnerInstance}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\ensure-ai.ps1" "${PROJECT_DIR}\installer\ensure-ai.ps1"
    StrCpy $R8 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ensure-ai.ps1"'
    nsExec::ExecToStack '$R8 -Check'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      ${IfNot} ${Silent}
        MessageBox MB_YESNO|MB_ICONQUESTION "Odysseus has an AI pane that runs AI coding tools in your repositories. These aren't installed yet:$\r$\n$\r$\n$1$\r$\nInstall them now? Claude Code comes from claude.ai; Codex, Gemini and Copilot come from npm and need Node.js." IDNO odysseus_skip_ai
      ${EndIf}
      Banner::show /set 76 "Installing AI tools" "Installing Claude Code and other AI command-line tools."
      nsExec::ExecToStack '$R8 -Install'
      Pop $0
      Pop $1
      Banner::destroy
      odysseus_skip_ai:
    ${EndIf}
    ; The commit skill (commits without AI co-author lines) for Claude Code, Codex, Gemini and Copilot.
    nsExec::Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --install-skills'
    Pop $0
  ${EndIf}
  !insertmacro odysseusRegisterTypes
!macroend

; An update runs the old uninstaller first; the file types stay registered through it.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro odysseusUnregisterTypes
  ${EndIf}
!macroend

; Text file types Odysseus can open in its editor. Registering them puts Odysseus in Open With
; and in Settings > Default apps; it never changes which app a type opens with. The user does.
!macro odysseusTypes OP
  !insertmacro ${OP} ".txt"
  !insertmacro ${OP} ".log"
  !insertmacro ${OP} ".md"
  !insertmacro ${OP} ".markdown"
  !insertmacro ${OP} ".json"
  !insertmacro ${OP} ".jsonc"
  !insertmacro ${OP} ".json5"
  !insertmacro ${OP} ".yml"
  !insertmacro ${OP} ".yaml"
  !insertmacro ${OP} ".toml"
  !insertmacro ${OP} ".ini"
  !insertmacro ${OP} ".cfg"
  !insertmacro ${OP} ".conf"
  !insertmacro ${OP} ".xml"
  !insertmacro ${OP} ".csv"
  !insertmacro ${OP} ".tsv"
  !insertmacro ${OP} ".env"
  !insertmacro ${OP} ".gitignore"
  !insertmacro ${OP} ".gitattributes"
  !insertmacro ${OP} ".editorconfig"
  !insertmacro ${OP} ".js"
  !insertmacro ${OP} ".mjs"
  !insertmacro ${OP} ".cjs"
  !insertmacro ${OP} ".ts"
  !insertmacro ${OP} ".tsx"
  !insertmacro ${OP} ".jsx"
  !insertmacro ${OP} ".css"
  !insertmacro ${OP} ".scss"
  !insertmacro ${OP} ".html"
  !insertmacro ${OP} ".htm"
  !insertmacro ${OP} ".py"
  !insertmacro ${OP} ".sh"
  !insertmacro ${OP} ".ps1"
  !insertmacro ${OP} ".sql"
!macroend

!define ODYSSEUS_PROGID "Odysseus.TextFile"
!define ODYSSEUS_CAPS "Software\Odysseus\Capabilities"

!macro odysseusAddType EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${ODYSSEUS_PROGID}" ""
  WriteRegStr SHELL_CONTEXT "${ODYSSEUS_CAPS}\FileAssociations" "${EXT}" "${ODYSSEUS_PROGID}"
!macroend

!macro odysseusRemoveType EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${ODYSSEUS_PROGID}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids"
!macroend

!macro odysseusRegisterTypes
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ODYSSEUS_PROGID}" "" "Text file"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ODYSSEUS_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ODYSSEUS_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHELL_CONTEXT "${ODYSSEUS_CAPS}" "ApplicationName" "Odysseus"
  WriteRegStr SHELL_CONTEXT "${ODYSSEUS_CAPS}" "ApplicationDescription" "Git client and text editor"
  !insertmacro odysseusTypes odysseusAddType
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Odysseus" "${ODYSSEUS_CAPS}"
  ; Tell Explorer the associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro odysseusUnregisterTypes
  !insertmacro odysseusTypes odysseusRemoveType
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Odysseus"
  DeleteRegKey SHELL_CONTEXT "${ODYSSEUS_CAPS}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Odysseus"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${ODYSSEUS_PROGID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

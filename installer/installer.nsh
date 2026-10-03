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
!macroend

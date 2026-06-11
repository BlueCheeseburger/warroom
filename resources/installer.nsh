; Custom NSIS hooks for Warroom (auto-included by electron-builder when present
; in buildResources). Removes the background-daemon scheduled task on uninstall so
; no orphaned task is left pointing at a deleted Warroom.exe.

!macro customUnInstall
  ; /f = force (no prompt). Errors (e.g. task absent) are ignored.
  nsExec::Exec 'schtasks /delete /tn "WarroomDaemon" /f'
!macroend

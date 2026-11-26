; XMP Launcher — NSIS installer customizations
; Records the install location for the launcher's own tooling and keeps
; uninstall clean. No file associations are touched on purpose.

!macro customInstall
  WriteRegStr HKCU "Software\XMP\Launcher" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\XMP\Launcher" "Version" "${VERSION}"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\XMP\Launcher"
!macroend

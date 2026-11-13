' Starts the server with no console window (reminders keep running in the background).
' Put a shortcut to this file in  shell:startup  to launch it when Windows starts.
' Stop it with stop.bat. Build the interface first (run start.bat once).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
sh.Run "cmd /c npm start", 0, False

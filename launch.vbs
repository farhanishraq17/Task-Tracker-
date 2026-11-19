' Desktop launcher (the "Command Center" desktop shortcut points here).
' Starts the server hidden if it is not already running, then opens the app in the browser.
' Stop the server with stop.bat.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName) ' data\ and .env are resolved from here

Function Up() ' True when the server answers. Port 3000: change here too if PORT is set in .env
  Dim h, ok
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 1000, 1000, 1000, 1000
  h.open "GET", "http://127.0.0.1:3000/api/settings", False
  h.send
  ok = (Err.Number = 0)
  If ok Then ok = (h.status = 200)
  Up = ok
End Function

If Not Up() Then
  If Not (fso.FolderExists("node_modules") And fso.FileExists("client\dist\index.html")) Then
    sh.Run "start.bat" ' first run: installs, builds and opens the app itself
    WScript.Quit
  End If
  sh.Run "cmd /c npm start", 0, False
  For i = 1 To 60 ' wait up to ~30s for the server
    If Up() Then Exit For
    WScript.Sleep 500
  Next
  If Not Up() Then
    MsgBox "The server did not start. Run start.bat in " & sh.CurrentDirectory & " to see the error.", 48, "Command Center"
    WScript.Quit 1
  End If
End If
sh.Run "http://localhost:3000"

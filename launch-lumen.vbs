Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Check if server is running on port 3847
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
On Error Resume Next
http.Open "GET", "http://localhost:3847/api/health", False
http.setTimeouts 800, 800, 800, 800
http.Send
serverRunning = (Err.Number = 0 And http.Status = 200)
On Error Goto 0

If Not serverRunning Then
    ' Start server silently in the background (0 = hidden, False = don't wait)
    WshShell.CurrentDirectory = "c:\Users\kenis\OneDrive\Desktop\saatvik\project 1\lumen"
    WshShell.Run "node server.cjs", 0, False
    WScript.Sleep 1200
End If

' Launch standalone desktop app window in Edge (or fallback to Chrome / default browser)
On Error Resume Next
WshShell.Run "msedge.exe --app=""http://localhost:3847"" --window-size=1300,860", 1, False
If Err.Number <> 0 Then
    WshShell.Run "chrome.exe --app=""http://localhost:3847"" --window-size=1300,860", 1, False
End If

Set WshShell = CreateObject("WScript.Shell")

' Check if Lumen server is already active on port 3847
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
On Error Resume Next
http.Open "GET", "http://127.0.0.1:3847/api/health", False
http.setTimeouts 1000, 1000, 1000, 1000
http.Send
serverRunning = (Err.Number = 0 And http.Status = 200)
On Error Goto 0

If Not serverRunning Then
    ' Start Lumen backend completely silently in the background (0 = hidden window, False = asynchronous)
    WshShell.CurrentDirectory = "C:\Users\kenis\OneDrive\Desktop\saatvik\project 1\lumen"
    WshShell.Run "cmd /c ""C:\Program Files\nodejs\node.exe"" server.cjs", 0, False
End If

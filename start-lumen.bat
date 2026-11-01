@echo off
rem Start Lumen backend server and log output
cd /d "C:\Users\kenis\OneDrive\Desktop\saatvik\project 1\lumen"
rem Use full path to node in case PATH is not set
"C:\Program Files\nodejs\node.exe" server.cjs >> "%USERPROFILE%\lumen_server.log" 2>&1
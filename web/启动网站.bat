@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   气象信息判别器 · 本地原型
echo   正在启动本地服务器：http://127.0.0.1:8765
echo   关闭此窗口即可停止服务。
echo.
start "" "http://127.0.0.1:8765"
python -m http.server 8765 --bind 127.0.0.1
pause

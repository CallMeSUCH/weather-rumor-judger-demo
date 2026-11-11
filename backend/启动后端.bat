@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo   气象信息判别器 · 本地后端
echo   网页：http://127.0.0.1:8766
echo   API ：http://127.0.0.1:8766/api/health
echo   关闭此窗口即可停止服务。
echo.
start "" "http://127.0.0.1:8766"
python backend\server.py 8766
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 词计划 · 四级词汇周计划训练台
echo 正在启动本地服务 http://127.0.0.1:5199 ...
start "" http://127.0.0.1:5199
node server.mjs
pause

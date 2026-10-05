@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title 卸载 Android 构建工具

rem ---------------------------------------------------------------
rem  把 tools\android_sdk.mjs 下载的一切删干净。
rem  这些东西只是为了「把词计划打包成 apk」才下载的，平时完全可以不要。
rem ---------------------------------------------------------------

set "HERE=%~dp0"
pushd "%HERE%..\.." || (echo 找不到工作目录 & pause & exit /b 1)
set "SDK=%CD%\android-sdk"

echo.
echo   词计划 —— 卸载 Android 构建工具
echo   ============================================================
echo   将删除这个目录（含 JDK 17、build-tools、platform-tools、android.jar）：
echo.
echo       %SDK%
echo.
if not exist "%SDK%" (
  echo   [i] 这个目录本来就不存在，无需卸载。
  goto :after_sdk
)

for /f "tokens=3" %%a in ('dir /-c "%SDK%" ^| findstr /i "个文件"') do set "SZ=%%a"
echo   大概占用 300 MB 左右。
echo.
set /p "ANS=   确认删除吗？输入 y 回车继续，其它键取消： "
if /i not "!ANS!"=="y" (
  echo   已取消，什么都没删。
  goto :after_sdk
)

echo   正在删除 ...
rd /s /q "%SDK%"
if exist "%SDK%" (
  echo   [!] 没能完全删除，可能有进程占用（比如 adb 还在跑）。请关掉后重试。
) else (
  echo   [ok] 已删除 %SDK%
)

:after_sdk
echo.
echo   ------------------------------------------------------------
echo   另外，编译时还可能会用到这个目录（debug 签名证书的缓存处）：
echo.
echo       %USERPROFILE%\.android
echo.
if not exist "%USERPROFILE%\.android" (
  echo   [i] 它不存在，跳过。
  goto :done
)
set /p "ANS2=   一并删除吗？输入 y 回车继续，其它键跳过： "
if /i not "!ANS2!"=="y" (
  echo   已跳过。
  goto :done
)
rd /s /q "%USERPROFILE%\.android"
echo   [ok] 已删除 %USERPROFILE%\.android

:done
echo.
echo   ------------------------------------------------------------
echo   提示：项目自己的文件和已经打好的 apk 不受影响：
echo       cet4-trainer\android\      （壳工程源码）
echo       cet4-trainer\dist\词计划_1.1.apk
echo   以后想重新打包，再跑一次：
echo       cet4-trainer\tools\android_sdk.mjs
echo   ------------------------------------------------------------
echo.
popd
pause

@echo off
chcp 65001 >nul
echo ================================
echo   守岸人 3.0 - 启动中...
echo ================================
echo.

cd /d "%~dp0"

REM 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)

REM 检查统一认证服务密钥
if "%SITE_AUTH_INTERNAL_KEY%"=="" (
    echo [错误] 未配置 SITE_AUTH_INTERNAL_KEY。
    echo 请先设置环境变量，例如：
    echo setx SITE_AUTH_INTERNAL_KEY "至少32位的随机内部服务密钥"
    echo 然后重新打开命令行启动。
    pause
    exit /b 1
)

REM 安装依赖
echo [1/2] 检查依赖...
pip install -r server\requirements.txt -q 2>nul

REM 启动服务
echo [2/2] 启动服务器...
echo.
echo 服务地址: http://127.0.0.1:8006
echo 按 Ctrl+C 停止
echo.
python -m server.main

pause

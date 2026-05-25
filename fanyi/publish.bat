@echo off
echo ============================================
echo   ScreenTranslator - 打包脚本
echo ============================================
echo.

echo [1/2] 正在编译发布版本...
dotnet publish ScreenTranslator\ScreenTranslator.csproj -c Release -r win-x64 --self-contained false /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true

if %ERRORLEVEL% neq 0 (
    echo.
    echo 编译失败！请检查 .NET 8 SDK 是否已安装。
    pause
    exit /b 1
)

echo.
echo [2/2] 编译完成！
echo.
echo 输出目录: ScreenTranslator\bin\Release\net8.0-windows\win-x64\publish\
echo.
echo 注意: 用户需要安装 .NET 8 Desktop Runtime 才能运行此程序。
echo 下载地址: https://dotnet.microsoft.com/download/dotnet/8.0
echo.
pause

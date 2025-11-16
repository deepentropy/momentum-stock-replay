@echo off
REM Test Databento download locally
REM Usage: Edit this file to add your API key, then run: test_databento_local.bat

echo ========================================
echo Databento Local Test
echo ========================================

REM Set your API key here (replace with your actual key)
set DATABENTO_API_KEY=db-REPLACE-WITH-YOUR-32-CHAR-API-KEY

REM Check if API key is set
if "%DATABENTO_API_KEY%"=="db-REPLACE-WITH-YOUR-32-CHAR-API-KEY" (
    echo ERROR: Please edit this file and add your Databento API key
    echo Get your key from: https://databento.com/platform/keys
    pause
    exit /b 1
)

echo API key configured
echo.

REM Install dependencies if needed
echo Installing dependencies...
pip install -q -r requirements.txt

echo.
echo Running download script...
echo This may take 2-5 minutes for 500 symbols...
echo.

REM Run the download script
python scripts\download_databento_data.py

if errorlevel 1 (
    echo.
    echo ERROR: Download failed
    pause
    exit /b 1
) else (
    echo.
    echo ========================================
    echo SUCCESS: Download completed
    echo ========================================
    echo.
    echo Check the sessions\ folder for:
    echo - databento_ohlcv_YYYYMMDD.csv
    echo - databento_ohlcv_YYYYMMDD.json
    echo.
    pause
)

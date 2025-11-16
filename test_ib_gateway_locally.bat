@echo off
REM Local test script for IB Gateway Docker container
echo ========================================
echo Testing IB Gateway Docker Setup Locally
echo ========================================

REM Stop and remove any existing container
echo.
echo Stopping any existing ib-gateway container...
docker stop ib-gateway 2>nul
docker rm ib-gateway 2>nul

REM Start IB Gateway container
echo.
echo Starting IB Gateway container...
docker run -d ^
  --name ib-gateway ^
  -e TWS_USERID=otremo926 ^
  -e TWS_PASSWORD=yJuF3HUGzHQNCbS ^
  -e TRADING_MODE=paper ^
  -e VNC_SERVER_PASSWORD= ^
  -e TWOFA_TIMEOUT_ACTION=exit ^
  -e READ_ONLY_API=no ^
  -p 4002:4002 ^
  -p 5900:5900 ^
  ghcr.io/gnzsnz/ib-gateway:stable

if errorlevel 1 (
    echo ERROR: Failed to start container
    exit /b 1
)

echo.
echo Container started. Waiting for IB Gateway to initialize...
echo This may take 2-3 minutes...
echo.

REM Wait and check logs
timeout /t 10 /nobreak >nul

echo Checking container logs (first 30 seconds):
docker logs ib-gateway

echo.
echo ========================================
echo Waiting 2 minutes for full initialization...
timeout /t 120 /nobreak

echo.
echo ========================================
echo Final container logs:
docker logs ib-gateway

echo.
echo ========================================
echo Checking if port 4002 is accessible...
docker exec ib-gateway nc -z localhost 4002
if errorlevel 1 (
    echo ERROR: Port 4002 is NOT accessible
) else (
    echo SUCCESS: Port 4002 is accessible
)

echo.
echo ========================================
echo Container status:
docker ps -a --filter name=ib-gateway

echo.
echo ========================================
echo To view live logs, run: docker logs -f ib-gateway
echo To access VNC viewer: Connect to localhost:5900 (no password)
echo To stop container: docker stop ib-gateway
echo To remove container: docker rm ib-gateway
echo.
echo Press any key to test Python connection...
pause >nul

echo.
echo Testing Python connection to IB Gateway...
python -c "from ib_async import IB; ib = IB(); ib.connect('localhost', 4002, clientId=1, timeout=20); print('SUCCESS: Connected to IB Gateway'); ib.disconnect()"

if errorlevel 1 (
    echo.
    echo ERROR: Python connection failed
    echo Please check the logs above for errors
) else (
    echo.
    echo SUCCESS: Python can connect to IB Gateway
)

echo.
echo ========================================
echo Test complete. Container is still running.
echo Run "docker stop ib-gateway" to stop it.
echo ========================================

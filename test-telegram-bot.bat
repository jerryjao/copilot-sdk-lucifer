@echo off
cd /d "%~dp0"
echo Running build and test coverage...
npm run build && npm run test:coverage
pause

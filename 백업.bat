@echo off
chcp 65001 >nul
cd /d C:\Users\snike\whiteline-manager
git add .
git commit -m "backup %date% %time%"
git push
echo.
echo [OK] 백업 완료!
pause
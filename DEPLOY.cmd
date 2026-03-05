@echo off
echo Deploying Ain El Kharroube system...

git add -A
git commit -m "deploy update"
git push origin deploy/hosting-ready

echo.
echo Deployment pushed to GitHub.
echo Render and Vercel will now update automatically.
pause
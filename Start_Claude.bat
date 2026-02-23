@echo off
REM RouteCopilot2 - Claude Code Launcher
REM This opens Claude Code in the RouteCopilot2 directory

echo Starting Claude Code for RouteCopilot2...
echo.

cd /d "%~dp0"
claude .

REM If claude command doesn't work, try:
REM npx @anthropic-ai/claude-code .

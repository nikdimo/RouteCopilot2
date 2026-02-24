@echo off
cd /d "C:\Users\Nikola Dimovski\RouteCopilot2"
set "READ_FILE=Codex_Readme.md"
if exist "%READ_FILE%" (
  codex "Read %READ_FILE% first, summarize key points, then continue the session based on that context."
) else (
  codex
)

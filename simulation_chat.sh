#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

API_URL="http://localhost:3000"
USER_ID="demo-user-$$"
LANG="en"

clear
echo -e "${CYAN}"
echo "  __  __ _           "
echo " |  \/  (_)_ __ __ _ "
echo " | |\/| | | '__/ _\` |"
echo " | |  | | | | | (_| |"
echo " |_|  |_|_|_|  \__,_|"
echo -e "${NC}"
echo -e "${YELLOW}AI Companion That Remembers You${NC}"
echo ""

# Check if API is running
echo -e "${BLUE}Checking connection to Mira API...${NC}"
if ! curl -s "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Mira API is not running!${NC}"
    echo ""
    echo "Start the services first with:"
    echo -e "  ${GREEN}docker compose up -d${NC}"
    echo ""
    echo "Then run this script again."
    exit 1
fi
echo -e "${GREEN}Connected to Mira API${NC}"
echo ""

# Language selection
echo -e "${YELLOW}Select language / Choisir la langue:${NC}"
echo "  1) English"
echo "  2) Français"
echo ""
read -p "Choice [1]: " lang_choice
if [ "$lang_choice" = "2" ]; then
    LANG="fr"
    echo -e "${GREEN}Langue: Français${NC}"
else
    LANG="en"
    echo -e "${GREEN}Language: English${NC}"
fi

echo ""
echo "================================================"
echo ""

# Get initial greeting
echo -e "${MAGENTA}Mira:${NC}"
greeting=$(curl -s -X POST "$API_URL/api/v1/messages/greeting" \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"$USER_ID\",\"lang\":\"$LANG\"}" | jq -r '.greeting // .message // "Hey!"')
echo -e "${GREEN}$greeting${NC}"
echo ""

# Chat loop
while true; do
    echo -e "${CYAN}You:${NC}"
    read -r message

    # Exit commands
    if [ "$message" = "exit" ] || [ "$message" = "quit" ] || [ "$message" = "q" ]; then
        echo ""
        echo -e "${YELLOW}Bye! Mira will remember you next time.${NC}"
        break
    fi

    # Empty message
    if [ -z "$message" ]; then
        continue
    fi

    # Special commands
    if [ "$message" = "/memories" ]; then
        echo ""
        echo -e "${BLUE}=== Your Memories ===${NC}"
        curl -s "$API_URL/api/v1/memories?userId=$USER_ID" | jq -r '.memories[]? | "- \(.text) [\(.category)]"' 2>/dev/null || echo "No memories yet"
        echo ""
        continue
    fi

    if [ "$message" = "/profile" ]; then
        echo ""
        echo -e "${BLUE}=== Your Profile ===${NC}"
        curl -s "$API_URL/api/v1/profile/$USER_ID" | jq -r '.profile // "No profile yet"' 2>/dev/null
        echo ""
        continue
    fi

    if [ "$message" = "/help" ]; then
        echo ""
        echo -e "${BLUE}Commands:${NC}"
        echo "  /memories  - Show what Mira remembers about you"
        echo "  /profile   - Show your AI-generated profile"
        echo "  /help      - Show this help"
        echo "  exit       - Quit the chat"
        echo ""
        continue
    fi

    # Send message to Mira
    echo ""
    echo -e "${MAGENTA}Mira:${NC}"

    response=$(curl -s -X POST "$API_URL/chat" \
        -H "Content-Type: application/json" \
        -d "{\"userId\":\"$USER_ID\",\"message\":\"$message\",\"lang\":\"$LANG\"}")

    mira_reply=$(echo "$response" | jq -r '.response // "..."')
    echo -e "${GREEN}$mira_reply${NC}"
    echo ""
done

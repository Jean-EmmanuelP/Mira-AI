#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "  __  __ _           "
echo " |  \/  (_)_ __ __ _ "
echo " | |\/| | | '__/ _\` |"
echo " | |  | | | | | (_| |"
echo " |_|  |_|_|_|  \__,_|"
echo -e "${NC}"
echo -e "${YELLOW}AI Companion That Remembers You${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please copy .env.example to .env and add your API keys"
    echo "  cp .env.example .env"
    exit 1
fi

# Check for at least one LLM API key
if ! grep -qE "^(GOOGLE_GENERATIVE_AI_API_KEY|ANTHROPIC_API_KEY|MISTRAL_API_KEY|DEEPSEEK_API_KEY)=.+" .env 2>/dev/null; then
    echo -e "${YELLOW}Warning: No LLM API key found in .env${NC}"
    echo "Add at least one of: GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY"
fi

echo -e "${BLUE}Starting Mira with Docker Compose...${NC}"
echo ""

# Stop any existing containers
docker compose down 2>/dev/null

# Start with logs visible
echo -e "${GREEN}Starting services: MongoDB, Redis, Qdrant, Mira API${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""
echo "================================================"
echo ""

# Run docker compose with logs attached
docker compose up --build

